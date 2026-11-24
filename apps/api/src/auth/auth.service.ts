import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import type { AuthUser } from "../common/authenticated-request.ts";
import { isUniqueViolation } from "../common/prisma-errors.ts";
import { MailService } from "../mail/mail.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { generateToken, hashToken } from "./tokens.ts";

/** Verification links are valid for 24 hours (spec §3). */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** At most one verification email per account per 60 seconds (D5). */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const HASH_OPTIONS = { type: argon2.argon2id } as const;

/** One generic message for every bad-credentials case so the response never reveals which part was wrong. */
const INVALID_CREDENTIALS = "Invalid email or password";

function invalidOrExpiredToken(): BadRequestException {
  return new BadRequestException({
    message: "This verification link is invalid or has expired.",
    code: "INVALID_OR_EXPIRED_TOKEN",
  });
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash of a random password, verified against when the email is unknown so timing matches a real check. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /**
   * Creates an unverified account without a password and sends a verification email (review M1: the password is
   * chosen on the verification step, by whoever controls the mailbox). For an existing email nothing changes and no
   * email is sent (D6).
   */
  async register(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return;
    }

    const token = generateToken();
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        // passwordHash stays NULL until verification (CHECK constraint: NULL exactly while unverified).
        const user = await tx.user.create({ data: { email, createdAt: now } });
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS),
            createdAt: now,
          },
        });
      });
    } catch (error) {
      // A concurrent registration of the same email won the race: treat it like an existing account.
      if (isUniqueViolation(error)) {
        return;
      }
      throw error;
    }

    this.mail.sendVerificationEmailInBackground(email, token);
  }

  /**
   * Verifies the email and sets the account's password (review M1). The token must exist, be unused and unexpired.
   * Consuming the token, storing the password hash and setting emailVerifiedAt happen in one transaction, so either
   * all three happen or none does; of concurrent requests with the same token at most one succeeds.
   */
  async verifyEmail(token: string, password: string): Promise<void> {
    // 1. Cheap check without locks, so invalid tokens never cost an Argon2 hash.
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, usedAt: true, expiresAt: true },
    });
    if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      throw invalidOrExpiredToken();
    }

    // 2. Hash outside the transaction: no row lock is held during the slow Argon2 work.
    const passwordHash = await argon2.hash(password, HASH_OPTIONS);

    // 3. Atomic commit.
    const verified = await this.prisma.$transaction(async (tx) => {
      // Lock the user row first: the same lock order as resendVerification, so the two serialize instead of
      // deadlocking, and a resend cannot delete this token between the checks below and the commit.
      const users = await tx.$queryRaw<{ emailVerifiedAt: Date | null }[]>`
        SELECT "emailVerifiedAt" FROM "User" WHERE "id" = ${record.userId}::uuid FOR UPDATE`;
      if (users.length !== 1 || users[0]!.emailVerifiedAt !== null) {
        return false;
      }

      // Consume the token, re-checking use and expiry against the database clock read now, after the lock
      // (timestamps are stored as UTC without time zone, hence AT TIME ZONE 'UTC').
      const consumed = await tx.$executeRaw`
        UPDATE "EmailVerificationToken" AS t
           SET "usedAt" = db.now
          FROM (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) AS db
         WHERE t."id" = ${record.id}::uuid
           AND t."userId" = ${record.userId}::uuid
           AND t."usedAt" IS NULL
           AND t."expiresAt" > db.now`;
      if (consumed !== 1) {
        return false; // used, expired or deleted by a resend meanwhile; nothing was written
      }

      // Password and verification time are set together (the CHECK constraint requires both or neither).
      const updated = await tx.$executeRaw`
        UPDATE "User"
           SET "passwordHash" = ${passwordHash},
               "emailVerifiedAt" = (SELECT "usedAt" FROM "EmailVerificationToken" WHERE "id" = ${record.id}::uuid)
         WHERE "id" = ${record.userId}::uuid AND "emailVerifiedAt" IS NULL`;
      if (updated !== 1) {
        // Cannot happen while the row is locked; throwing rolls the token consumption back.
        throw new Error("Email verification: the user row changed while locked");
      }

      // Defensive: no other link of this account stays usable.
      await tx.emailVerificationToken.deleteMany({ where: { userId: record.userId, usedAt: null } });
      return true;
    });

    if (!verified) {
      throw invalidOrExpiredToken();
    }
  }

  /**
   * Issues a new verification token and sends it, invalidating earlier unused tokens.
   * Silently does nothing for unknown emails, verified accounts, or within 60 s of the newest token (D5, D6).
   */
  async resendVerification(email: string): Promise<void> {
    const now = new Date();
    const token = generateToken();

    const issued = await this.prisma.$transaction(async (tx) => {
      // Lock the user row so two concurrent resends cannot both pass the cooldown check.
      const users = await tx.$queryRaw<{ id: string; emailVerifiedAt: Date | null }[]>`
        SELECT "id", "emailVerifiedAt" FROM "User" WHERE "email" = ${email} FOR UPDATE`;
      const user = users[0];
      if (!user || user.emailVerifiedAt) {
        return false;
      }

      const newest = await tx.emailVerificationToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (newest && now.getTime() - newest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        return false;
      }

      await tx.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS),
          createdAt: now,
        },
      });
      return true;
    });

    if (issued) {
      this.mail.sendVerificationEmailInBackground(email, token);
    }
  }

  /**
   * Checks credentials. Wrong password, unknown email and unverified account (which has no password yet, review M1)
   * all get the same 401, after an Argon2 check so the timing matches.
   */
  async validateCredentials(email: string, password: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.passwordHash === null || user.emailVerifiedAt === null) {
      await argon2.verify(await this.getDummyHash(), password).catch(() => false);
      throw new UnauthorizedException({ message: INVALID_CREDENTIALS, code: "INVALID_CREDENTIALS" });
    }

    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(user.passwordHash, password);
    } catch (error) {
      this.logger.error(`Password verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!passwordOk) {
      throw new UnauthorizedException({ message: INVALID_CREDENTIALS, code: "INVALID_CREDENTIALS" });
    }

    return { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt, createdAt: user.createdAt };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash(generateToken(), HASH_OPTIONS);
    return this.dummyHash;
  }
}
