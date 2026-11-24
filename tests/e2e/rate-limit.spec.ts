import type { Page } from "@playwright/test";
import { postJson, registerForToken, TEST_PASSWORD, uniqueEmail } from "../support/auth.ts";
import { getVerificationLink } from "../support/mailpit.ts";
import { expect, test } from "../support/test.ts";

// 429 handling on the auth screens (review M2). Most tests answer one request with a 429 through page.route, so
// every screen and wording is covered deterministically without using up real limits; the last tests hit the real
// limits of the API (per email, so they do not affect other tests).

/** Answers the next request to `path` with a 429 (optionally with Retry-After), then lets requests through again. */
async function rateLimitOnce(page: Page, path: string, retryAfter: string | null): Promise<void> {
  await page.route(
    `**/api/auth/${path}`,
    (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: retryAfter === null ? {} : { "Retry-After": retryAfter },
        body: JSON.stringify({ statusCode: 429, message: "Too many requests.", code: "RATE_LIMITED" }),
      }),
    { times: 1 },
  );
}

test.describe("429 on the auth screens (mocked)", () => {
  test("sign-up: singular second", async ({ page }) => {
    await rateLimitOnce(page, "register", "1");
    await page.goto("/signup");
    await page.getByLabel("Email").fill(uniqueEmail("e2e"));
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 1 second.");
    await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible(); // still on the form

    // The next attempt goes through normally.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  });

  test("login: plural seconds; other errors keep their own message", async ({ page }) => {
    await rateLimitOnce(page, "login", "42");
    await page.goto("/login");
    await page.getByLabel("Email").fill(uniqueEmail("ghost"));
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 42 seconds.");

    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password"); // 401 unchanged
  });

  test("verify page: the form stays (the link was not used) and works on the next try", async ({ page, request }) => {
    const email = uniqueEmail("e2e");
    await registerForToken(request, email);
    const link = new URL(await getVerificationLink(email));
    await rateLimitOnce(page, "verify-email", "120");

    await page.goto(`${link.pathname}${link.search}`);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Verify email and set password" }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 2 minutes.");
    await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();

    await page.getByRole("button", { name: "Verify email and set password" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    expect((await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD })).status()).toBe(200);
  });

  test("resend page: minutes; without Retry-After a generic 'later' message", async ({ page }) => {
    await page.goto("/resend-verification");
    await page.getByLabel("Email").fill(uniqueEmail("nobody"));
    const resend = page.getByRole("button", { name: "Resend verification email" });

    await rateLimitOnce(page, "resend-verification", "3600");
    await resend.click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 60 minutes.");

    await rateLimitOnce(page, "resend-verification", null);
    await resend.click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Please try again later.");

    await resend.click();
    await expect(page.getByRole("status")).toContainText("If this account needs verification");
  });
});

test.describe("429 from the real API", () => {
  test("login: after 10 attempts for one email the screen says when to try again", async ({ page, request }) => {
    const email = uniqueEmail("e2e");
    for (let i = 0; i < 10; i += 1) {
      expect((await postJson(request, "/api/auth/login", { email, password: "wrong-password" })).status()).toBe(401);
    }
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password");
    const response = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "Log in" }).click();
    expect((await response).status()).toBe(429);
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 15 minutes.");
  });

  test("resend: after 3 requests for one email the screen says when to try again", async ({ page, request }) => {
    const email = uniqueEmail("nobody");
    for (let i = 0; i < 3; i += 1) {
      expect((await postJson(request, "/api/auth/resend-verification", { email })).status()).toBe(202);
    }
    await page.goto("/resend-verification");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Resend verification email" }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 60 minutes.");
  });
});
