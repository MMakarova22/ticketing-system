import type { APIRequestContext, APIResponse } from "@playwright/test";
import { randomInt } from "node:crypto";
import { createLoggedInUser, registerForToken, TEST_PASSWORD, uniqueEmail } from "../support/auth.ts";
import { listMessages, waitForMessageCount } from "../support/mailpit.ts";
import { expect, test, uniqueClientIp } from "../support/test.ts";

// Rate limits on the public auth endpoints (review M2). Needs a stack started with docker-compose.test.yml
// (TRUST_PROXY=uniquelocal) so the X-Forwarded-For addresses below are used as client IPs. Every test uses fresh
// addresses and emails, so no test shares a bucket with another one.
//
// | endpoint            | per IP     | per email  |
// | register            | 10 / hour  | 3 / hour   |
// | login               | 50 / 15min | 10 / 15min | (the email counter is reset by a successful login)
// | verify-email        | 20 / 15min | -          |
// | resend-verification | 10 / hour  | 3 / hour   | (plus the separate, silent 60 s per-account cooldown, D5)

test.use({ storageState: { cookies: [], origins: [] } });

const HOUR = 3600;
const FIFTEEN_MINUTES = 900;

function post(request: APIRequestContext, path: string, data: unknown, ip: string): Promise<APIResponse> {
  return request.post(path, { data, headers: { "X-Forwarded-For": ip } });
}

/** A random IPv4 address in the benchmarking range 198.18.0.0/15 (never a real client). */
function uniqueIPv4(): string {
  return `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** Asserts the standard 429 and returns its Retry-After seconds. */
async function expectRateLimited(response: APIResponse, windowSeconds: number, label = ""): Promise<number> {
  expect(response.status(), label).toBe(429);
  const retryAfter = Number(response.headers()["retry-after"]);
  expect(Number.isInteger(retryAfter), `${label}: Retry-After header`).toBe(true);
  expect(retryAfter, label).toBeGreaterThan(windowSeconds - 120);
  expect(retryAfter, label).toBeLessThanOrEqual(windowSeconds);
  expect(await response.json(), label).toEqual({
    statusCode: 429,
    message: `Too many requests. Try again in ${retryAfter} seconds.`,
    code: "RATE_LIMITED",
  });
  return retryAfter;
}

test.describe("register", () => {
  test("per IP: 10 per hour; other IPs are not affected", async ({ request }) => {
    const ip = uniqueClientIp();
    for (let i = 0; i < 10; i += 1) {
      expect((await post(request, "/api/auth/register", { email: uniqueEmail() }, ip)).status(), `#${i + 1}`).toBe(202);
    }
    await expectRateLimited(await post(request, "/api/auth/register", { email: uniqueEmail() }, ip), HOUR);
    expect((await post(request, "/api/auth/register", { email: uniqueEmail() }, uniqueClientIp())).status()).toBe(202);
  });

  test("per email: 3 per hour from any IPs; the same 429 for an existing account and a new address", async ({
    request,
  }) => {
    // Both addresses have used 1 of their 3 registrations: the existing account when it was created, the new address
    // with the request that creates it.
    const { email: existing } = await createLoggedInUser(request);
    const fresh = uniqueEmail();
    expect((await post(request, "/api/auth/register", { email: fresh }, uniqueClientIp())).status()).toBe(202);
    for (const email of [existing, fresh]) {
      for (let i = 0; i < 2; i += 1) {
        expect((await post(request, "/api/auth/register", { email }, uniqueClientIp())).status()).toBe(202);
      }
      // Any spelling of the address shares the bucket (the key is the hash of the normalized email).
      const spelled = ` ${email.toUpperCase()} `;
      await expectRateLimited(await post(request, "/api/auth/register", { email: spelled }, uniqueClientIp()), HOUR);
    }
  });

  test("the IP bucket is checked first: requests it blocks do not use up the email's allowance", async ({ request }) => {
    const blockedIp = uniqueClientIp();
    for (let i = 0; i < 10; i += 1) {
      await post(request, "/api/auth/register", { email: uniqueEmail() }, blockedIp);
    }
    const email = uniqueEmail();
    for (let i = 0; i < 5; i += 1) {
      await expectRateLimited(await post(request, "/api/auth/register", { email }, blockedIp), HOUR);
    }
    // The email bucket is still untouched: 3 requests from other IPs are allowed.
    for (let i = 0; i < 3; i += 1) {
      expect((await post(request, "/api/auth/register", { email }, uniqueClientIp())).status()).toBe(202);
    }
    await expectRateLimited(await post(request, "/api/auth/register", { email }, uniqueClientIp()), HOUR);
  });

  test("limits apply after validation: rejected bodies (400) are not counted", async ({ request }) => {
    const ip = uniqueClientIp();
    for (let i = 0; i < 15; i += 1) {
      const invalid = i % 2 === 0 ? { email: "not-an-email" } : { email: uniqueEmail(), password: TEST_PASSWORD };
      expect((await post(request, "/api/auth/register", invalid, ip)).status()).toBe(400);
    }
    for (let i = 0; i < 10; i += 1) {
      expect((await post(request, "/api/auth/register", { email: uniqueEmail() }, ip)).status()).toBe(202);
    }
    await expectRateLimited(await post(request, "/api/auth/register", { email: uniqueEmail() }, ip), HOUR);
  });

  test("a blocked request has no effect: no account and no email", async ({ request }) => {
    const ip = uniqueClientIp();
    for (let i = 0; i < 10; i += 1) {
      await post(request, "/api/auth/register", { email: uniqueEmail() }, ip);
    }
    const email = uniqueEmail();
    await expectRateLimited(await post(request, "/api/auth/register", { email }, ip), HOUR);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await listMessages(email)).toHaveLength(0);

    // From another IP the address registers normally (it did not exist yet: an email is sent).
    expect((await post(request, "/api/auth/register", { email }, uniqueClientIp())).status()).toBe(202);
    await waitForMessageCount(email, 1);
  });
});

test.describe("login", () => {
  test("per email: 10 attempts per 15 minutes; then 429 even with the right password", async ({ request }) => {
    const { email } = await createLoggedInUser(request); // its successful login reset the counter
    for (let i = 0; i < 10; i += 1) {
      const wrong = await post(request, "/api/auth/login", { email, password: "wrong-password" }, uniqueClientIp());
      expect(wrong.status(), `#${i + 1}`).toBe(401);
    }
    await expectRateLimited(
      await post(request, "/api/auth/login", { email, password: TEST_PASSWORD }, uniqueClientIp()),
      FIFTEEN_MINUTES,
    );
  });

  test("an unknown email is limited exactly like an existing account", async ({ request }) => {
    const { email: existing } = await createLoggedInUser(request);
    const unknown = uniqueEmail("ghost");
    const statuses: Record<string, number[]> = { existing: [], unknown: [] };
    for (const [label, email] of [["existing", existing], ["unknown", unknown]] as const) {
      for (let i = 0; i < 11; i += 1) {
        const response = await post(request, "/api/auth/login", { email, password: "wrong-password" }, uniqueClientIp());
        statuses[label]!.push(response.status());
        if (i === 10) {
          await expectRateLimited(response, FIFTEEN_MINUTES, label);
        }
      }
    }
    expect(statuses.unknown).toEqual(statuses.existing);
    expect(statuses.existing).toEqual([...Array<number>(10).fill(401), 429]);
  });

  test("a successful login resets the email counter", async ({ request }) => {
    const { email } = await createLoggedInUser(request);
    for (let i = 0; i < 9; i += 1) {
      expect((await post(request, "/api/auth/login", { email, password: "wrong-password" }, uniqueClientIp())).status()).toBe(401);
    }
    // 10th attempt (still allowed) succeeds and resets the counter ...
    expect((await post(request, "/api/auth/login", { email, password: TEST_PASSWORD }, uniqueClientIp())).status()).toBe(200);
    // ... so 10 more attempts are allowed before the next 429.
    for (let i = 0; i < 10; i += 1) {
      expect((await post(request, "/api/auth/login", { email, password: "wrong-password" }, uniqueClientIp())).status(), `#${i + 1}`).toBe(401);
    }
    await expectRateLimited(
      await post(request, "/api/auth/login", { email, password: "wrong-password" }, uniqueClientIp()),
      FIFTEEN_MINUTES,
    );
  });

  test("per IP: 50 attempts per 15 minutes across any emails; other IPs are not affected", async ({ request }) => {
    const { email } = await createLoggedInUser(request);
    const ip = uniqueClientIp();
    const attempts = await Promise.all(
      Array.from({ length: 50 }, () =>
        post(request, "/api/auth/login", { email: uniqueEmail("ghost"), password: "wrong-password" }, ip),
      ),
    );
    expect(attempts.map((r) => r.status())).toEqual(Array<number>(50).fill(401));
    // Blocked by the IP bucket, even with valid credentials.
    await expectRateLimited(await post(request, "/api/auth/login", { email, password: TEST_PASSWORD }, ip), FIFTEEN_MINUTES);
    expect((await post(request, "/api/auth/login", { email, password: TEST_PASSWORD }, uniqueClientIp())).status()).toBe(200);
  });
});

test.describe("verify-email", () => {
  test("per IP: 20 per 15 minutes; a blocked request does not use the link", async ({ request }) => {
    const email = uniqueEmail();
    const token = await registerForToken(request, email);
    const ip = uniqueClientIp();
    for (let i = 0; i < 20; i += 1) {
      const garbage = await post(request, "/api/auth/verify-email", { token: `garbage-${i}`, password: TEST_PASSWORD }, ip);
      expect(garbage.status(), `#${i + 1}`).toBe(400);
    }
    await expectRateLimited(
      await post(request, "/api/auth/verify-email", { token, password: TEST_PASSWORD }, ip),
      FIFTEEN_MINUTES,
    );
    // The link was not consumed: it still works from another IP.
    expect((await post(request, "/api/auth/verify-email", { token, password: TEST_PASSWORD }, uniqueClientIp())).status()).toBe(200);
    expect((await post(request, "/api/auth/login", { email, password: TEST_PASSWORD }, uniqueClientIp())).status()).toBe(200);
  });
});

test.describe("resend-verification", () => {
  test("per IP: 10 per hour; other IPs are not affected", async ({ request }) => {
    const ip = uniqueClientIp();
    for (let i = 0; i < 10; i += 1) {
      expect((await post(request, "/api/auth/resend-verification", { email: uniqueEmail("nobody") }, ip)).status()).toBe(202);
    }
    await expectRateLimited(await post(request, "/api/auth/resend-verification", { email: uniqueEmail("nobody") }, ip), HOUR);
    expect((await post(request, "/api/auth/resend-verification", { email: uniqueEmail("nobody") }, uniqueClientIp())).status()).toBe(202);
  });

  test("per email: 3 per hour; the same for unknown, unverified and verified addresses", async ({ request }) => {
    const unverified = uniqueEmail();
    await registerForToken(request, unverified);
    const { email: verified } = await createLoggedInUser(request);
    const unknown = uniqueEmail("nobody");
    for (const [label, email] of [["unknown", unknown], ["unverified", unverified], ["verified", verified]] as const) {
      for (let i = 0; i < 3; i += 1) {
        expect((await post(request, "/api/auth/resend-verification", { email }, uniqueClientIp())).status(), label).toBe(202);
      }
      await expectRateLimited(await post(request, "/api/auth/resend-verification", { email }, uniqueClientIp()), HOUR, label);
    }
  });

  test("the 60 s per-account cooldown (D5) still works on its own, inside the rate limit", async ({ request }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail();
    await registerForToken(request, email); // email #1
    const resend = () => post(request, "/api/auth/resend-verification", { email }, uniqueClientIp());

    // 1st resend: within 60 s of the registration email -> silent 202, no email (cooldown, not the rate limit).
    expect((await resend()).status()).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    // 2nd resend: cooldown over -> a new email.
    expect((await resend()).status()).toBe(202);
    await waitForMessageCount(email, 2);
    // 3rd resend: within 60 s of the new email -> silent 202 again.
    expect((await resend()).status()).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await listMessages(email)).toHaveLength(2);
    // 4th resend: the per-email rate limit (3 per hour) -> 429.
    await expectRateLimited(await resend(), HOUR);
  });
});

test.describe("client address normalization", () => {
  test("all addresses of one IPv6 /64 share a bucket; another /64 does not", async ({ request }) => {
    const prefix = uniqueClientIp().replace(/::1$/, "");
    for (let i = 1; i <= 10; i += 1) {
      const ip = `${prefix}:${i.toString(16)}::${i.toString(16)}`;
      expect((await post(request, "/api/auth/register", { email: uniqueEmail() }, ip)).status(), ip).toBe(202);
    }
    await expectRateLimited(
      await post(request, "/api/auth/register", { email: uniqueEmail() }, `${prefix}:ffff:ffff:ffff:ffff`),
      HOUR,
    );
    expect((await post(request, "/api/auth/register", { email: uniqueEmail() }, uniqueClientIp())).status()).toBe(202);
  });

  test("an IPv4-mapped IPv6 address shares the bucket of the IPv4 address", async ({ request }) => {
    const ipv4 = uniqueIPv4();
    for (let i = 0; i < 10; i += 1) {
      const ip = i % 2 === 0 ? ipv4 : `::ffff:${ipv4}`;
      expect((await post(request, "/api/auth/register", { email: uniqueEmail() }, ip)).status(), ip).toBe(202);
    }
    await expectRateLimited(await post(request, "/api/auth/register", { email: uniqueEmail() }, ipv4), HOUR);
    await expectRateLimited(await post(request, "/api/auth/register", { email: uniqueEmail() }, `::ffff:${ipv4}`), HOUR);
  });
});
