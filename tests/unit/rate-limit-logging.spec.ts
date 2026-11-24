import { expect, test } from "@playwright/test";
import type { Request } from "express";
import { AuthRateLimitService } from "../../apps/api/src/auth/auth-rate-limit.service.ts";
import { hashEmail } from "../../apps/api/src/common/rate-limit/keys.ts";
import { LogThrottle } from "../../apps/api/src/common/rate-limit/log-throttle.ts";
import { RateLimitedException } from "../../apps/api/src/common/rate-limit/rate-limited.exception.ts";

test.describe("LogThrottle (fake clock)", () => {
  test("allows the first line per key, then nothing until the window has passed", () => {
    let now = 1_000_000;
    const throttle = new LogThrottle(() => now);
    expect(throttle.shouldLog("login:email", 60_000)).toBe(true);
    expect(throttle.shouldLog("login:email", 60_000)).toBe(false);
    now += 59_999;
    expect(throttle.shouldLog("login:email", 60_000)).toBe(false);
    now += 1;
    expect(throttle.shouldLog("login:email", 60_000)).toBe(true); // a new window
    expect(throttle.shouldLog("login:email", 60_000)).toBe(false);
  });

  test("keys are independent", () => {
    const throttle = new LogThrottle(() => 0);
    expect(throttle.shouldLog("login:email", 60_000)).toBe(true);
    expect(throttle.shouldLog("login:ip", 60_000)).toBe(true);
    expect(throttle.shouldLog("register:email", 60_000)).toBe(true);
    expect(throttle.shouldLog("login:email", 60_000)).toBe(false);
  });
});

test.describe("AuthRateLimitService logging", () => {
  /** The real service with its Nest logger replaced by a recorder. */
  function serviceWithRecorder() {
    const service = new AuthRateLimitService();
    const warnings: string[] = [];
    (service as unknown as { logger: { warn: (m: string) => void } }).logger = { warn: (m) => warnings.push(m) };
    return { service, warnings };
  }

  /** Runs one consume() and returns "ok" or the 429's Retry-After seconds. */
  function attempt(service: AuthRateLimitService, ...args: Parameters<AuthRateLimitService["consume"]>): "ok" | number {
    try {
      service.consume(...args);
      return "ok";
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitedException);
      expect((error as RateLimitedException).getStatus()).toBe(429);
      return (error as RateLimitedException).retryAfterSeconds;
    }
  }

  test("every blocked request gets a 429, but only the first one is logged", () => {
    const { service, warnings } = serviceWithRecorder();
    const req = { ip: "203.0.113.9" } as Request;
    try {
      const results = Array.from({ length: 30 }, (_, i) => attempt(service, "register", req, `user${i}@example.test`));
      expect(results.slice(0, 10)).toEqual(Array<string>(10).fill("ok"));
      const blocked = results.slice(10);
      expect(blocked).toHaveLength(20);
      for (const seconds of blocked) {
        expect(typeof seconds === "number" && seconds > 0).toBe(true); // all 20 blocked requests: 429
      }
      expect(warnings).toEqual([
        "Rate limit reached: register (ip bucket); further blocks of this kind are not logged for 60 min",
      ]);
    } finally {
      service.onModuleDestroy();
    }
  });

  test("each policy + bucket combination logs once on its own", () => {
    const { service, warnings } = serviceWithRecorder();
    try {
      const email = "victim@example.test";
      // login email bucket: 10 allowed (from different IPs), then blocked.
      for (let i = 0; i < 15; i += 1) {
        attempt(service, "login", { ip: `198.51.100.${i + 1}` } as Request, email);
      }
      // login IP bucket: 50 allowed, then blocked.
      const ip = { ip: "2001:db8:aa:bb::1" } as Request;
      for (let i = 0; i < 55; i += 1) {
        attempt(service, "login", ip, `other${i}@example.test`);
      }
      // verify-email IP bucket: 20 allowed, then blocked.
      for (let i = 0; i < 25; i += 1) {
        attempt(service, "verifyEmail", ip);
      }
      expect(warnings).toEqual([
        "Rate limit reached: login (email bucket); further blocks of this kind are not logged for 15 min",
        "Rate limit reached: login (ip bucket); further blocks of this kind are not logged for 15 min",
        "Rate limit reached: verifyEmail (ip bucket); further blocks of this kind are not logged for 15 min",
      ]);

      // No email, IP, hash or other identifying value in any warning.
      const sensitive = [email, "example.test", "198.51.100", "2001:db8", hashEmail(email), "@"];
      for (const warning of warnings) {
        for (const value of sensitive) {
          expect(warning, warning).not.toContain(value);
        }
      }
    } finally {
      service.onModuleDestroy();
    }
  });
});
