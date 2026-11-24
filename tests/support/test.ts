import { test as base } from "@playwright/test";
import { randomBytes } from "node:crypto";

export { expect } from "@playwright/test";

/**
 * A client address no other test uses: a random /64 in the IPv6 documentation range 2001:db8::/32 (the rate limiter
 * keys IPv6 clients by /64), so collisions within a run and across runs (buckets live up to an hour) are negligible.
 */
export function uniqueClientIp(): string {
  const bytes = randomBytes(4); // the two groups after 2001:db8 complete the /64: 2^32 possible networks
  return `2001:db8:${bytes.readUInt16BE(0).toString(16)}:${bytes.readUInt16BE(2).toString(16)}::1`;
}

/**
 * Every API and browser test imports `test` from here. Each test sends its own X-Forwarded-For address, so the
 * per-IP rate limits (review M2) never leak between tests. It only takes effect on a stack started with
 * docker-compose.test.yml (TRUST_PROXY=uniquelocal); the default stack ignores the header.
 * Contexts created with playwright.request.newContext() do not get the header; pass it in extraHTTPHeaders if such a
 * context calls a rate-limited endpoint (register, login, verify-email, resend-verification).
 */
export const test = base.extend<{ clientIp: string }>({
  clientIp: async ({}, use) => {
    await use(uniqueClientIp());
  },
  extraHTTPHeaders: async ({ extraHTTPHeaders, clientIp }, use) => {
    await use({ ...extraHTTPHeaders, "X-Forwarded-For": clientIp });
  },
});
