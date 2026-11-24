import { type APIRequestContext, type APIResponse, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { getVerificationLink, tokenFromLink } from "./mailpit.ts";

export const SESSION_COOKIE = "tt_session";

/**
 * Password for every test account: 24 cryptographically random bytes, base64url (32 characters, within the
 * API's 8–256 rule). playwright.config.ts generates it once per run and all workers inherit it; the fallback only
 * applies when this module is loaded without that config. Never log it.
 */
export const TEST_PASSWORD: string = (process.env.TT_TEST_PASSWORD ??= randomBytes(24).toString("base64url"));
if (TEST_PASSWORD.length < 8 || TEST_PASSWORD.length > 256) {
  throw new Error("TT_TEST_PASSWORD must be 8-256 characters long");
}

/** A unique address per test run, so tests never depend on existing data. */
export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

export function postJson(request: APIRequestContext, path: string, data: unknown, cookie?: string): Promise<APIResponse> {
  return request.post(path, { data, headers: cookie ? { Cookie: cookie } : {} });
}

/**
 * Returns "name=value" for the session cookie in a response, for sending back manually.
 * (API tests pass the cookie explicitly instead of relying on the client cookie jar and the Secure flag.)
 */
export function sessionCookieFrom(response: APIResponse): string {
  const header = response.headersArray().find(
    (h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${SESSION_COOKIE}=`),
  );
  if (!header) {
    throw new Error("No session cookie in response");
  }
  return header.value.split(";")[0] ?? "";
}

/** Registers (email only) and returns the token from the verification email. */
export async function registerForToken(request: APIRequestContext, email: string): Promise<string> {
  const register = await postJson(request, "/api/auth/register", { email });
  expect(register.status()).toBe(202);
  return tokenFromLink(await getVerificationLink(email));
}

/** Registers, then verifies the email and sets the password in one step (review M1). */
export async function registerAndVerify(request: APIRequestContext, email: string, password = TEST_PASSWORD): Promise<void> {
  const token = await registerForToken(request, email);
  const verify = await postJson(request, "/api/auth/verify-email", { token, password });
  expect(verify.status()).toBe(200);
}

/** Registers, verifies and logs in a fresh user; returns the session cookie ("name=value"). */
export async function createLoggedInUser(
  request: APIRequestContext,
  email = uniqueEmail(),
  password = TEST_PASSWORD,
): Promise<{ email: string; cookie: string }> {
  await registerAndVerify(request, email, password);
  const login = await postJson(request, "/api/auth/login", { email, password });
  expect(login.status()).toBe(200);
  return { email, cookie: sessionCookieFrom(login) };
}
