import { expect, test } from "../support/test.ts";
import { postJson, registerForToken, TEST_PASSWORD, uniqueEmail } from "../support/auth.ts";
import { getVerificationLink } from "../support/mailpit.ts";
import { verifyAndSetPasswordViaUi } from "../support/ui.ts";

test.describe("authentication screens", () => {
  test("sign up with email only, choose the password from the emailed link, log in, log out", async ({ page }) => {
    const email = uniqueEmail("e2e");

    await page.goto("/signup");
    await expect(page.getByLabel("Password")).toHaveCount(0); // the password is chosen later (review M1)
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

    await verifyAndSetPasswordViaUi(page, await getVerificationLink(email));
    await expect(page.getByTestId("user-menu")).toHaveCount(0); // no automatic login

    await page.getByRole("link", { name: "Continue to login" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await expect(page.getByTestId("user-menu")).toHaveText(email);

    // Session survives a reload.
    await page.reload();
    await expect(page.getByTestId("user-menu")).toHaveText(email);

    await page.getByTestId("user-menu").click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Protected pages are no longer reachable.
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the session token never appears in URLs, redirects, API bodies or script-visible storage", async ({ page, context }) => {
    const email = uniqueEmail("e2e");
    const navigations: string[] = [];
    const requestUrls: string[] = [];
    const redirects: string[] = [];
    const apiBodies: Promise<string>[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    page.on("request", (request) => requestUrls.push(request.url()));
    page.on("response", (response) => {
      const location = response.headers()["location"];
      if (location) redirects.push(location);
      if (response.url().includes("/api/") && response.status() !== 204) {
        apiBodies.push(response.text().catch(() => ""));
      }
    });

    // Sign up and verify through the emailed link (the one URL allowed to carry a token).
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    const link = await getVerificationLink(email);
    const verificationToken = new URL(link).searchParams.get("token");
    await verifyAndSetPasswordViaUi(page, link);

    // Log in and use the main screens.
    await page.getByRole("link", { name: "Continue to login" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByTestId("user-menu")).toHaveText(email);

    const session = (await context.cookies()).find((c) => c.name === "tt_session");
    expect(session, "session cookie is set").toBeTruthy();
    const token = session!.value;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(token).not.toBe(verificationToken);

    for (const path of ["/teams", "/epics", "/"]) {
      await page.goto(path);
      await expect(page.getByTestId("user-menu")).toHaveText(email);
    }
    await page.reload();
    await expect(page.getByTestId("user-menu")).toHaveText(email);

    // HttpOnly: page scripts cannot read it, and the app never copies it into browser storage.
    const visible = await page.evaluate(() => ({
      cookie: document.cookie,
      storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
    }));
    expect(visible.cookie).not.toContain("tt_session");
    expect(visible.storage).not.toContain(token);
    // Neither the verification token nor the password is kept in browser storage either.
    expect(visible.storage).not.toContain(verificationToken!);
    expect(visible.storage).not.toContain(TEST_PASSWORD);

    await page.getByTestId("user-menu").click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((c) => c.name === "tt_session")).toBe(false);

    // No URL, redirect or API response body ever carried the session token (raw or URL-encoded).
    const forms = [token, encodeURIComponent(token)];
    const bodies = await Promise.all(apiBodies);
    for (const [where, values] of [
      ["navigation URL", navigations],
      ["request URL", requestUrls],
      ["redirect Location", redirects],
      ["API response body", bodies],
    ] as const) {
      for (const value of values) {
        for (const form of forms) {
          expect(value.includes(form), `${where} contains the session token: ${value.slice(0, 200)}`).toBe(false);
        }
        // The password travels only in request bodies, never in a URL or a response.
        expect(value.includes(TEST_PASSWORD), `${where} contains the password`).toBe(false);
      }
    }

    // The only URLs with a token parameter are the verification link, carrying the verification token.
    const withToken = [...navigations, ...requestUrls].filter((u) => new URL(u).searchParams.has("token"));
    expect(withToken.length).toBeGreaterThan(0);
    for (const url of withToken) {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/verify-email");
      expect(parsed.searchParams.get("token")).toBe(verificationToken);
    }
    expect(navigations.length).toBeGreaterThan(5);
    expect(bodies.length).toBeGreaterThan(5);
  });

  test("unauthenticated deep link redirects to login and returns after login", async ({ page }) => {
    const email = uniqueEmail("e2e");
    // Register through the UI-independent API (no DB access), then verify through the emailed link.
    await registerForToken(page.request, email);
    await verifyAndSetPasswordViaUi(page, await getVerificationLink(email));

    await page.goto("/epics");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/epics$/);
    await expect(page.getByRole("heading", { name: "Epics" })).toBeVisible();
  });

  test("the verify page checks password length and confirmation before using the link", async ({ page, request }) => {
    const email = uniqueEmail("e2e");
    await registerForToken(request, email);
    const link = new URL(await getVerificationLink(email));
    let verifyRequests = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/auth/verify-email")) verifyRequests += 1;
    });

    await page.goto(`${link.pathname}${link.search}`);
    await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
    const password = page.getByLabel("Password", { exact: true });
    const confirmation = page.getByLabel("Confirm password");
    const submit = page.getByRole("button", { name: "Verify email and set password" });
    const error = page.getByRole("alert");

    const tooShort = "1234567";
    await password.fill(tooShort);
    await confirmation.fill(tooShort);
    await submit.click();
    await expect(error).toHaveText("Password must be between 8 and 256 characters.");

    const tooLong = "x".repeat(257);
    await password.fill(tooLong);
    await confirmation.fill(tooLong);
    await submit.click();
    await expect(error).toHaveText("Password must be between 8 and 256 characters.");

    await password.fill(TEST_PASSWORD);
    await confirmation.fill(`${TEST_PASSWORD}x`);
    await submit.click();
    await expect(error).toHaveText("The passwords do not match.");

    // A password that differs only by surrounding spaces is a different password (never trimmed).
    await confirmation.fill(` ${TEST_PASSWORD} `);
    await submit.click();
    await expect(error).toHaveText("The passwords do not match.");

    // Nothing was sent so far, so the link is still unused.
    expect(verifyRequests).toBe(0);
    await confirmation.fill(TEST_PASSWORD);
    await submit.click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    expect(verifyRequests).toBe(1);

    const login = await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD });
    expect(login.status()).toBe(200);
  });

  test("an unverified account gets the generic login error; the login page links to the resend page", async ({
    page,
  }) => {
    const email = uniqueEmail("e2e");
    expect((await postJson(page.request, "/api/auth/register", { email })).status()).toBe(202);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
    await expect(page.getByText("not verified")).toHaveCount(0); // account state is never revealed

    await page.getByRole("link", { name: "Resend it" }).click();
    await expect(page).toHaveURL(/\/resend-verification$/);
    await expect(page.getByRole("heading", { name: "Resend verification email" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    const sent = page.waitForResponse((r) => r.url().endsWith("/api/auth/resend-verification"));
    await page.getByRole("button", { name: "Resend verification email" }).click();
    const response = await sent;
    expect(response.status()).toBe(202);
    expect(response.request().postDataJSON()).toEqual({ email });
    await expect(page.getByRole("status")).toContainText("If this account needs verification");
  });

  test("the resend page is reachable without logging in and gives the same answer for unknown emails", async ({
    page,
  }) => {
    await page.goto("/resend-verification");
    await expect(page.getByRole("heading", { name: "Resend verification email" })).toBeVisible();
    await page.getByLabel("Email").fill(uniqueEmail("nobody"));
    await page.getByRole("button", { name: "Resend verification email" }).click();
    await expect(page.getByRole("status")).toContainText("If this account needs verification");
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("wrong credentials show a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(uniqueEmail("ghost"));
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
  });

  test("invalid verification link shows an error and a resend form", async ({ page }) => {
    await page.goto("/verify-email?token=definitely-invalid");
    await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
    await expect(page).toHaveURL(/\/verify-email$/);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Verify email and set password" }).click();
    await expect(page.getByRole("heading", { name: "Verification failed" })).toBeVisible();
    await expect(page.getByText("invalid or has expired")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  });

  test("a verification page without a token shows an error and a resend form", async ({ page }) => {
    await page.goto("/verify-email");
    await expect(page.getByRole("heading", { name: "Verification failed" })).toBeVisible();
    await expect(page.getByText("missing its token")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  });
});
