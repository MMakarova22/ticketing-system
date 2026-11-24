import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AuthUser } from "../common/authenticated-request.ts";
import { CurrentUser } from "../common/current-user.decorator.ts";
import { Public } from "../common/public.decorator.ts";
import { AuthRateLimitService } from "./auth-rate-limit.service.ts";
import { AuthService } from "./auth.service.ts";
import { EmailDto, LoginDto, RegisterDto, VerifyEmailDto } from "./dto/auth.dto.ts";
import { SessionService } from "./session.service.ts";

/** Public, user-facing view of an account. Never includes the password hash. */
export interface UserView {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

/** Identical for new and existing emails so the response never reveals whether an email is registered (D6). */
const REGISTER_ACCEPTED = {
  message: "If this email can be registered, a verification email has been sent. Check your inbox.",
} as const;
const RESEND_ACCEPTED = {
  message: "If this account needs verification, a new email has been sent. Check your inbox.",
} as const;

function toUserView(user: AuthUser): UserView {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
  ) {}

  // Rate limits (review M2) are counted at the start of each handler: after the global ValidationPipe (invalid
  // bodies are rejected with 400 and not counted; the email is already normalized) and before any database work.

  @Public()
  @Post("register")
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<typeof REGISTER_ACCEPTED> {
    this.limits.consume("register", req, dto.email);
    await this.auth.register(dto.email);
    return REGISTER_ACCEPTED;
  }

  /** Verifies the email and sets the password (review M1). Never logs the user in: no session cookie is set. */
  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request): Promise<{ verified: true }> {
    this.limits.consume("verifyEmail", req);
    await this.auth.verifyEmail(dto.token, dto.password);
    return { verified: true };
  }

  @Public()
  @Post("resend-verification")
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Body() dto: EmailDto, @Req() req: Request): Promise<typeof RESEND_ACCEPTED> {
    // The 60 s per-account cooldown (D5) is separate and still silent (same 202).
    this.limits.consume("resend", req, dto.email);
    await this.auth.resendVerification(dto.email);
    return RESEND_ACCEPTED;
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserView }> {
    // Every attempt counts (also concurrent ones); a successful login clears the per-email counter.
    this.limits.consume("login", req, dto.email);
    const user = await this.auth.validateCredentials(dto.email, dto.password);
    this.limits.resetEmail("login", dto.email);
    await this.sessions.create(user.id, req, res);
    return { user: toUserView(user) };
  }

  /**
   * Public (review L3) so a missing, invalid, expired or unknown session cookie is still cleared: always 204.
   * Still JSON-only like every state-changing request (415 otherwise), which keeps cross-site logout out.
   */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(req, res);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): UserView {
    return toUserView(user);
  }
}
