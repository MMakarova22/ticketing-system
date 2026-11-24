import { Inject, Injectable } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import type { AuthUser } from "../common/authenticated-request.ts";
import { readCookie } from "../common/cookies.ts";
import { APP_CONFIG, type AppConfig } from "../config/app-config.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { generateToken, hashToken } from "./tokens.ts";

export const SESSION_COOKIE = "tt_session";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cookie-based sessions (D4): random token in an HttpOnly cookie, only its SHA-256 hash in the DB. */
@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates a session for a verified user and sets the cookie. Expiry is absolute (no sliding renewal). */
  async create(userId: string, req: Request, res: Response): Promise<void> {
    const token = generateToken();
    const now = Date.now();
    const ttlMs = this.config.sessionTtlDays * DAY_MS;

    // Housekeeping: drop this user's expired sessions.
    await this.prisma.session.deleteMany({ where: { userId, expiresAt: { lte: new Date(now) } } });
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(now + ttlMs),
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent")?.slice(0, 512) ?? null,
      },
    });

    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: ttlMs });
  }

  /** Returns the user behind the request's session cookie, or null. Expired sessions are deleted. */
  async resolve(req: Request): Promise<{ sessionId: string; user: AuthUser } | null> {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      return null;
    }
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, emailVerifiedAt: true, createdAt: true } } },
    });
    if (!session) {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    if (!session.user.emailVerifiedAt) {
      return null;
    }
    return { sessionId: session.id, user: session.user };
  }

  /**
   * Logout (review L3): deletes the session behind the request's cookie, if any, whether it is valid, expired or
   * unknown, and always clears the cookie. Never fails because of the cookie's content.
   */
  async revoke(req: Request, res: Response): Promise<void> {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
    this.clearCookie(res);
  }

  private clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.config.cookieSecure, sameSite: "lax", path: "/" };
  }
}
