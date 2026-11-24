import { expect, test } from "../support/test.ts";
import {
  createLoggedInUser,
  postJson,
  registerAndVerify,
  registerForToken,
  SESSION_COOKIE,
  TEST_PASSWORD,
  uniqueEmail,
} from "../support/auth.ts";
import { getVerificationLink, listMessages, tokenFromLink, waitForMessageCount } from "../support/mailpit.ts";

// Each request gets a fresh cookie jar unless a cookie is passed explicitly.
test.use({ storageState: { cookies: [], origins: [] } });

/** The generic 401 body for every failed login (wrong password, unknown email, unverified account). */
const INVALID_CREDENTIALS_BODY = { statusCode: 401, message: "Invalid email or password", code: "INVALID_CREDENTIALS" };

function login(request: Parameters<typeof postJson>[0], email: string, password: string) {
  return postJson(request, "/api/auth/login", { email, password });
}

test.describe("registration (email only, review M1)", () => {
  test("new and existing emails get the same 202 response; no second email is sent", async ({ request }) => {
    const email = uniqueEmail();
    const first = await postJson(request, "/api/auth/register", { email });
    expect(first.status()).toBe(202);
    await waitForMessageCount(email, 1);

    const second = await postJson(request, "/api/auth/register", { email });
    expect(second.status()).toBe(202);
    expect(await second.json()).toEqual(await first.json());

    // Existing (still unverified) account: nothing changes and no new email is sent.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await listMessages(email)).toHaveLength(1);
  });

  test("a password in the registration body is rejected with 400 and creates nothing", async ({ request }) => {
    const email = uniqueEmail();
    const withPassword = await postJson(request, "/api/auth/register", { email, password: TEST_PASSWORD });
    expect(withPassword.status()).toBe(400);
    const body = await withPassword.json();
    expect(body).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(body.message).toContain("password");

    // No account and no email: registering the same address afterwards behaves like a new account.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await listMessages(email)).toHaveLength(0);
    expect((await postJson(request, "/api/auth/register", { email })).status()).toBe(202);
    await waitForMessageCount(email, 1);
  });

  test("email is trimmed and lower-cased", async ({ request }) => {
    const email = uniqueEmail("MixedCase");
    const register = await postJson(request, "/api/auth/register", { email: `  ${email.toUpperCase()}  ` });
    expect(register.status()).toBe(202);

    const token = tokenFromLink(await getVerificationLink(email.toLowerCase()));
    expect((await postJson(request, "/api/auth/verify-email", { token, password: TEST_PASSWORD })).status()).toBe(200);

    const response = await login(request, ` ${email} `, TEST_PASSWORD);
    expect(response.status()).toBe(200);
    expect((await response.json()).user.email).toBe(email.toLowerCase());
  });

  test("rejects invalid email, missing fields and unknown fields with 400", async ({ request }) => {
    expect((await postJson(request, "/api/auth/register", { email: "not-an-email" })).status()).toBe(400);
    expect((await postJson(request, "/api/auth/register", {})).status()).toBe(400);
    const extra = await postJson(request, "/api/auth/register", { email: uniqueEmail(), role: "admin" });
    expect(extra.status()).toBe(400);
  });

  test("state-changing requests must be JSON (415)", async ({ request }) => {
    const form = await request.post("/api/auth/register", { form: { email: uniqueEmail() } });
    expect(form.status()).toBe(415);
    expect(await form.json()).toMatchObject({ statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" });

    const text = await request.post("/api/auth/login", {
      data: "{}",
      headers: { "Content-Type": "text/plain" },
    });
    expect(text.status()).toBe(415);

    // DELETE is held to the same rule (even without a body).
    const del = await request.delete("/api/auth/me");
    expect(del.status()).toBe(415);
  });

  test("malformed JSON is a 400", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ statusCode: 400 });
  });
});

test.describe("email verification sets the password (review M1)", () => {
  test("the emailed link verifies once and sets the password; no automatic login", async ({ request }) => {
    const email = uniqueEmail();
    expect((await postJson(request, "/api/auth/register", { email })).status()).toBe(202);
    const link = await getVerificationLink(email);
    expect(link).toMatch(/\/verify-email\?token=/);
    const token = tokenFromLink(link);

    const ok = await postJson(request, "/api/auth/verify-email", { token, password: TEST_PASSWORD });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ verified: true });
    expect(ok.headers()["set-cookie"]).toBeUndefined();

    expect((await login(request, email, TEST_PASSWORD)).status()).toBe(200);

    // Single use: the link cannot be used again, not even to change the password.
    const reused = await postJson(request, "/api/auth/verify-email", { token, password: "another-password" });
    expect(reused.status()).toBe(400);
    expect(await reused.json()).toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    expect((await login(request, email, "another-password")).status()).toBe(401);
    expect((await login(request, email, TEST_PASSWORD)).status()).toBe(200);
  });

  test("garbage, empty and missing tokens are rejected", async ({ request }) => {
    const garbage = await postJson(request, "/api/auth/verify-email", { token: "not-a-real-token", password: TEST_PASSWORD });
    expect(garbage.status()).toBe(400);
    expect(await garbage.json()).toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });

    const empty = await postJson(request, "/api/auth/verify-email", { token: "", password: TEST_PASSWORD });
    expect(empty.status()).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    const missing = await postJson(request, "/api/auth/verify-email", { password: TEST_PASSWORD });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("an invalid or missing password is a 400 and does not consume the token", async ({ request }) => {
    const email = uniqueEmail();
    const token = await registerForToken(request, email);

    const invalid: [string, unknown][] = [
      ["missing", undefined],
      ["7 characters", "1234567"],
      ["257 characters", "x".repeat(257)],
      ["empty", ""],
      ["not a string", 12345678],
      ["null", null],
    ];
    for (const [label, password] of invalid) {
      const response = await postJson(
        request,
        "/api/auth/verify-email",
        password === undefined ? { token } : { token, password },
      );
      expect(response.status(), label).toBe(400);
      const body = await response.json();
      expect(body, label).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
      expect(body.message, label).toContain("password");
    }

    // Still unverified (generic 401), and the same link still works.
    expect((await login(request, email, TEST_PASSWORD)).status()).toBe(401);
    expect((await postJson(request, "/api/auth/verify-email", { token, password: TEST_PASSWORD })).status()).toBe(200);
    expect((await login(request, email, TEST_PASSWORD)).status()).toBe(200);
  });

  test("passwords of exactly 8 and 256 characters are accepted; the password is not trimmed", async ({ request }) => {
    const passwords = ["12345678", "x".repeat(256), "  spaced password  "];
    for (const password of passwords) {
      const email = uniqueEmail();
      await registerAndVerify(request, email, password);
      expect((await login(request, email, password)).status(), `${password.length} chars`).toBe(200);
    }
    const spacedEmail = uniqueEmail();
    await registerAndVerify(request, spacedEmail, "  spaced password  ");
    expect((await login(request, spacedEmail, "spaced password")).status()).toBe(401);
    expect((await login(request, spacedEmail, "  spaced password  ")).status()).toBe(200);
  });

  test("pre-registration: whoever registers an address cannot choose its password", async ({ request }) => {
    // The attacker registers the victim's address. A password cannot be sent along (400) ...
    const victim = uniqueEmail("victim");
    expect((await postJson(request, "/api/auth/register", { email: victim, password: "attacker-password" })).status()).toBe(400);
    // ... so the account is created without one.
    expect((await postJson(request, "/api/auth/register", { email: victim })).status()).toBe(202);
    for (const guess of ["attacker-password", TEST_PASSWORD]) {
      expect((await login(request, victim, guess)).status()).toBe(401);
    }

    // The link goes to the victim's mailbox; the victim sets the password.
    const token = tokenFromLink(await getVerificationLink(victim));
    const victimPassword = `${TEST_PASSWORD}-victim`;
    expect((await postJson(request, "/api/auth/verify-email", { token, password: victimPassword })).status()).toBe(200);

    expect((await login(request, victim, victimPassword)).status()).toBe(200);
    expect((await login(request, victim, "attacker-password")).status()).toBe(401);
    // Registering again changes nothing for the verified account.
    expect((await postJson(request, "/api/auth/register", { email: victim })).status()).toBe(202);
    expect((await login(request, victim, victimPassword)).status()).toBe(200);
  });

  test("concurrent verifications with one token: exactly one succeeds and only its password works", async ({ request }) => {
    const email = uniqueEmail();
    const token = await registerForToken(request, email);
    const passwords = Array.from({ length: 6 }, (_, i) => `${TEST_PASSWORD}-${i}`);

    const responses = await Promise.all(
      passwords.map((password) => postJson(request, "/api/auth/verify-email", { token, password })),
    );
    const statuses = responses.map((r) => r.status());
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(passwords.length - 1);
    for (const response of responses.filter((r) => r.status() === 400)) {
      expect(await response.json()).toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    }

    const winner = passwords[statuses.indexOf(200)]!;
    for (const password of passwords) {
      expect((await login(request, email, password)).status()).toBe(password === winner ? 200 : 401);
    }
  });

  test("concurrent verify and resend never fail with 500 and leave a consistent account", async ({ request }) => {
    // Resend only issues a new link 60 s after the newest one (D5), so the race needs accounts older than that.
    test.setTimeout(120_000);
    const accounts = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const email = uniqueEmail("race");
        return { email, token: await registerForToken(request, email) };
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 61_000));

    const results = await Promise.all(
      accounts.map(async ({ email, token }) => {
        const [verify, resend] = await Promise.all([
          postJson(request, "/api/auth/verify-email", { token, password: TEST_PASSWORD }),
          postJson(request, "/api/auth/resend-verification", { email }),
        ]);
        return { email, verify: verify.status(), resend: resend.status() };
      }),
    );

    for (const { email, verify, resend } of results) {
      expect(resend, email).toBe(202);
      expect([200, 400], email).toContain(verify);
      if (verify === 200) {
        // Verify won: the account is verified with this password and resend did nothing.
        expect((await login(request, email, TEST_PASSWORD)).status()).toBe(200);
      } else {
        // Resend won: the old link was replaced; the new one works.
        const newToken = tokenFromLink(await getVerificationLink(email, 2));
        const second = await postJson(request, "/api/auth/verify-email", { token: newToken, password: TEST_PASSWORD });
        expect(second.status(), email).toBe(200);
        expect((await login(request, email, TEST_PASSWORD)).status()).toBe(200);
      }
    }
    // Where verify won, resend saw a verified account and sent nothing: only the registration email exists.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const { email } of results.filter((r) => r.verify === 200)) {
      expect(await listMessages(email), email).toHaveLength(1);
    }
  });
});

test.describe("resend verification", () => {
  test("always 202 with the same body; rate-limited to one email per 60 s", async ({ request }) => {
    const email = uniqueEmail();
    await postJson(request, "/api/auth/register", { email });
    await waitForMessageCount(email, 1);

    const withinCooldown = await postJson(request, "/api/auth/resend-verification", { email });
    expect(withinCooldown.status()).toBe(202);

    const unknown = await postJson(request, "/api/auth/resend-verification", { email: uniqueEmail("nobody") });
    expect(unknown.status()).toBe(202);
    expect(await unknown.json()).toEqual(await withinCooldown.json());

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await listMessages(email)).toHaveLength(1);
  });

  test("does nothing for an already verified account", async ({ request }) => {
    const email = uniqueEmail();
    await registerAndVerify(request, email);
    const response = await postJson(request, "/api/auth/resend-verification", { email });
    expect(response.status()).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await listMessages(email)).toHaveLength(1);
  });

  test("invalid email is a 400", async ({ request }) => {
    expect((await postJson(request, "/api/auth/resend-verification", { email: "nope" })).status()).toBe(400);
  });
});

test.describe("login, session and logout", () => {
  test("an unverified account (no password yet) gets the same 401 as an unknown email, for any password", async ({
    request,
  }) => {
    const email = uniqueEmail();
    expect((await postJson(request, "/api/auth/register", { email })).status()).toBe(202);
    const unknown = await login(request, uniqueEmail("ghost"), TEST_PASSWORD);
    expect(unknown.status()).toBe(401);
    expect(await unknown.json()).toEqual(INVALID_CREDENTIALS_BODY);

    for (const password of [TEST_PASSWORD, "wrong-password", "12345678"]) {
      const response = await login(request, email, password);
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual(INVALID_CREDENTIALS_BODY);
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
  });

  test("wrong password and unknown email return the same 401", async ({ request }) => {
    const email = uniqueEmail();
    await registerAndVerify(request, email);
    const wrongPassword = await postJson(request, "/api/auth/login", { email, password: "wrong-password" });
    const unknownEmail = await postJson(request, "/api/auth/login", { email: uniqueEmail("ghost"), password: TEST_PASSWORD });
    expect(wrongPassword.status()).toBe(401);
    expect(unknownEmail.status()).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  test("successful login sets a hardened session cookie and returns the user without secrets", async ({ request }) => {
    const email = uniqueEmail();
    await registerAndVerify(request, email);
    const response = await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.user).toMatchObject({ email });
    expect(Object.keys(body.user).sort()).toEqual(["createdAt", "email", "emailVerifiedAt", "id"]);
    expect(JSON.stringify(body)).not.toContain(TEST_PASSWORD);

    const setCookie = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
    expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
    expect(setCookie).toMatch(/;\s*Secure/i); // COOKIE_SECURE defaults to true
    const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1]);
    expect(maxAge).toBe(7 * 24 * 60 * 60);
  });

  test("GET /api/auth/me requires a session and returns the current user", async ({ request }) => {
    expect((await request.get("/api/auth/me")).status()).toBe(401);
    expect((await request.get("/api/auth/me", { headers: { Cookie: `${SESSION_COOKIE}=forged` } })).status()).toBe(401);

    const { email, cookie } = await createLoggedInUser(request);
    const me = await request.get("/api/auth/me", { headers: { Cookie: cookie } });
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.email).toBe(email);
    expect(body.emailVerifiedAt).toMatch(/Z$/);
    expect(body).not.toHaveProperty("passwordHash");
  });

  test("logout invalidates the session server-side and clears the cookie", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const logout = await request.post("/api/auth/logout", { data: {}, headers: { Cookie: cookie } });
    expect(logout.status()).toBe(204);
    const cleared = logout.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
    expect(cleared).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));

    // The old cookie value no longer works.
    expect((await request.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(401);
    // Logging out again with the stale cookie still succeeds and clears it (review L3).
    const again = await request.post("/api/auth/logout", { data: {}, headers: { Cookie: cookie } });
    expect(again.status()).toBe(204);
    expect(again.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "").toMatch(
      new RegExp(`^${SESSION_COOKIE}=;`),
    );
  });

  test("health stays public and unknown API routes are JSON 404 even without a session", async ({ request }) => {
    expect((await request.get("/api/health")).status()).toBe(200);
    const missing = await request.get("/api/nope");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ statusCode: 404 });
  });
});
