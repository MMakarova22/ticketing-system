import { expect, test } from "@playwright/test";
import { RateLimitedException } from "../../apps/api/src/common/rate-limit/rate-limited.exception.ts";
import { describeTrustProxy, parseTrustProxy } from "../../apps/api/src/config/trust-proxy.ts";

test.describe("TRUST_PROXY parsing", () => {
  test("disabled by default: unset, empty, false, 0", () => {
    for (const raw of [undefined, "", "   ", "false", "FALSE", " false ", "0"]) {
      expect(parseTrustProxy(raw), JSON.stringify(raw)).toEqual({ value: false });
    }
    expect(describeTrustProxy(false)).toBe("disabled (X-Forwarded-For is ignored)");
  });

  test("true is rejected (it would trust X-Forwarded-For from any client)", () => {
    for (const raw of ["true", "TRUE", " True "]) {
      const result = parseTrustProxy(raw);
      expect("error" in result && result.error, raw).toContain("TRUST_PROXY=true is not allowed");
    }
  });

  test("hop counts 1-10", () => {
    expect(parseTrustProxy("1")).toEqual({ value: 1 });
    expect(parseTrustProxy(" 10 ")).toEqual({ value: 10 });
    for (const raw of ["11", "00", "99999"]) {
      expect(parseTrustProxy(raw), raw).toHaveProperty("error");
    }
    expect(describeTrustProxy(2)).toBe("2 hop(s)");
  });

  test("presets loopback and uniquelocal, IPs and CIDR ranges, comma-separated", () => {
    expect(parseTrustProxy("uniquelocal")).toEqual({ value: ["uniquelocal"] });
    expect(parseTrustProxy("Loopback, UNIQUELOCAL")).toEqual({ value: ["loopback", "uniquelocal"] });
    const list = "10.0.0.0/8, 172.16.0.0/12,192.168.1.10, ::1, fd00::/8, 2001:db8::/32";
    expect(parseTrustProxy(list)).toEqual({
      value: ["10.0.0.0/8", "172.16.0.0/12", "192.168.1.10", "::1", "fd00::/8", "2001:db8::/32"],
    });
    expect(describeTrustProxy(["loopback", "10.0.0.0/8"])).toBe("loopback, 10.0.0.0/8");
  });

  test("anything else is rejected, including ranges that would trust everyone", () => {
    for (const raw of [
      "0.0.0.0/0",
      "::/0",
      "loopback, 0.0.0.0/0",
      "linklocal", // not an approved preset
      "all",
      "yes",
      "10.0.0.0/33",
      "fd00::/129",
      "10.0.0.0/x",
      "10.0.0.1/8/9",
      "1, loopback",
      "loopback,",
      ",",
      "300.1.1.1",
      "-1",
    ]) {
      const result = parseTrustProxy(raw);
      expect(result, raw).toHaveProperty("error");
    }
  });
});

test.describe("RateLimitedException", () => {
  test("429 with the standard body and the Retry-After seconds", () => {
    const error = new RateLimitedException(42);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toEqual({ message: "Too many requests. Try again in 42 seconds.", code: "RATE_LIMITED" });
    expect(error.retryAfterSeconds).toBe(42);
  });

  test("singular for 1 second, plural otherwise", () => {
    expect(new RateLimitedException(1).getResponse()).toMatchObject({ message: "Too many requests. Try again in 1 second." });
    expect(new RateLimitedException(2).getResponse()).toMatchObject({ message: "Too many requests. Try again in 2 seconds." });
    expect(new RateLimitedException(0.4).getResponse()).toMatchObject({ message: "Too many requests. Try again in 1 second." });
  });

  test("seconds are rounded up and at least 1", () => {
    expect(new RateLimitedException(0.2).retryAfterSeconds).toBe(1);
    expect(new RateLimitedException(0).retryAfterSeconds).toBe(1);
    expect(new RateLimitedException(899.01).retryAfterSeconds).toBe(900);
  });
});
