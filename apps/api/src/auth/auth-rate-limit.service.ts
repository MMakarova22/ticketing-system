import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Request } from "express";
import { hashEmail, normalizeClientIp } from "../common/rate-limit/keys.ts";
import { LogThrottle } from "../common/rate-limit/log-throttle.ts";
import { RateLimitedException } from "../common/rate-limit/rate-limited.exception.ts";
import { type RateLimitRule, RateLimiter } from "../common/rate-limit/rate-limiter.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type AuthRateLimitPolicy = "register" | "login" | "verifyEmail" | "resend";

/** Approved limits (review M2). Per IP is checked first; per email only where a policy has one. */
export const AUTH_RATE_LIMITS: Record<AuthRateLimitPolicy, { ip: RateLimitRule; email?: RateLimitRule }> = {
  register: { ip: { limit: 10, windowMs: HOUR_MS }, email: { limit: 3, windowMs: HOUR_MS } },
  login: { ip: { limit: 50, windowMs: 15 * MINUTE_MS }, email: { limit: 10, windowMs: 15 * MINUTE_MS } },
  verifyEmail: { ip: { limit: 20, windowMs: 15 * MINUTE_MS } },
  resend: { ip: { limit: 10, windowMs: HOUR_MS }, email: { limit: 3, windowMs: HOUR_MS } },
};

/**
 * Rate limits for the public auth endpoints (review M2).
 *
 * - The per-IP key is req.ip (which honours TRUST_PROXY; X-Forwarded-For is ignored unless it is set), normalized:
 *   IPv4-mapped IPv6 -> IPv4, other IPv6 -> /64.
 * - The per-email key is the SHA-256 of the normalized email; raw addresses are never kept or logged.
 * - The decision depends only on the IP, the email and the request count, never on whether the account exists, so a
 *   429 reveals nothing about an account. It is made before any database work.
 *
 * Process-local (see RateLimiter): not shared between instances and reset on restart.
 *
 * Logging: one warning per policy and bucket per rate-limit window (the first blocked request); every blocked request
 * still gets its 429. Warnings name only the policy and the bucket type, never an email, IP, hash or key.
 */
@Injectable()
export class AuthRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthRateLimitService.name);
  private readonly limiter = new RateLimiter();
  private readonly logThrottle = new LogThrottle();

  /**
   * Counts one request against the IP bucket, then (if allowed and the policy has one) the email bucket. Throws
   * RateLimitedException (429 + Retry-After) when either is exhausted. A request blocked by the IP bucket does not
   * touch the email bucket, so a blocked client cannot use up someone else's per-email allowance.
   */
  consume(policy: AuthRateLimitPolicy, req: Request, email?: string): void {
    const rules = AUTH_RATE_LIMITS[policy];
    const ip = this.limiter.consume(`${policy}:ip:${normalizeClientIp(req.ip)}`, rules.ip);
    if (!ip.allowed) {
      this.block(policy, "ip", rules.ip, ip.retryAfterSeconds);
    }
    if (rules.email && email !== undefined) {
      const byEmail = this.limiter.consume(this.emailKey(policy, email), rules.email);
      if (!byEmail.allowed) {
        this.block(policy, "email", rules.email, byEmail.retryAfterSeconds);
      }
    }
  }

  /** Clears the per-email bucket of a policy (login: after a successful login). */
  resetEmail(policy: AuthRateLimitPolicy, email: string): void {
    this.limiter.reset(this.emailKey(policy, email));
  }

  onModuleDestroy(): void {
    this.limiter.dispose();
  }

  private emailKey(policy: AuthRateLimitPolicy, email: string): string {
    return `${policy}:email:${hashEmail(email)}`;
  }

  private block(
    policy: AuthRateLimitPolicy,
    bucket: "ip" | "email",
    rule: RateLimitRule,
    retryAfterSeconds: number,
  ): never {
    // Only the first block per policy and bucket within a window is logged; the response is always 429.
    if (this.logThrottle.shouldLog(`${policy}:${bucket}`, rule.windowMs)) {
      const minutes = Math.round(rule.windowMs / 60_000);
      this.logger.warn(
        `Rate limit reached: ${policy} (${bucket} bucket); further blocks of this kind are not logged for ${minutes} min`,
      );
    }
    throw new RateLimitedException(retryAfterSeconds);
  }
}
