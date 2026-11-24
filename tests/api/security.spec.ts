import { type APIRequestContext, type APIResponse } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addComment,
  createEpic,
  createTeam,
  createTicket,
  type EpicBody,
  getJson,
  type TeamBody,
  type TicketBody,
  uniqueName,
} from "../support/api.ts";
import {
  createLoggedInUser,
  postJson,
  registerAndVerify,
  SESSION_COOKIE,
  sessionCookieFrom,
  TEST_PASSWORD,
  uniqueEmail,
} from "../support/auth.ts";
import { getVerificationLink, tokenFromLink } from "../support/mailpit.ts";

// Each request gets a fresh cookie jar; cookies are only ever sent explicitly.
test.use({ storageState: { cookies: [], origins: [] } });

const EXPECTED_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy": "frame-ancestors 'none'",
};

function expectSecurityHeaders(response: APIResponse, label: string): void {
  const headers = response.headers();
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(headers[name], `${label}: ${name}`).toBe(value);
  }
}

test.describe("security response headers", () => {
  test("API responses carry the headers, including errors", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expectSecurityHeaders(health, "GET /api/health (200)");

    const unauthenticated = await request.get("/api/teams");
    expect(unauthenticated.status()).toBe(401);
    expectSecurityHeaders(unauthenticated, "GET /api/teams without session (401)");

    const unknownRoute = await request.get("/api/does-not-exist");
    expect(unknownRoute.status()).toBe(404);
    expectSecurityHeaders(unknownRoute, "unknown API route (404)");

    const malformedJson = await request.post("/api/auth/login", {
      headers: { "Content-Type": "application/json" },
      data: "{not json",
    });
    expect(malformedJson.status()).toBe(400);
    expectSecurityHeaders(malformedJson, "malformed JSON body (400)");

    const wrongContentType = await request.post("/api/auth/login", { form: { email: "a@b.c", password: "x" } });
    expect(wrongContentType.status()).toBe(415);
    expectSecurityHeaders(wrongContentType, "non-JSON state-changing request (415)");
  });

  test("the SPA index page, client-side routes and static assets carry the headers", async ({ request }) => {
    const root = await request.get("/");
    expect(root.status()).toBe(200);
    expect(root.headers()["content-type"]).toContain("text/html");
    expectSecurityHeaders(root, "GET / (index.html)");

    const clientRoute = await request.get("/teams");
    expect(clientRoute.status()).toBe(200);
    expectSecurityHeaders(clientRoute, "GET /teams (index.html fallback)");

    // A hashed bundle referenced by index.html, served by the static file handler.
    const assetPath = /\/assets\/[^"']+\.js/.exec(await root.text())?.[0];
    expect(assetPath, "index.html references a JS bundle").toBeTruthy();
    const asset = await request.get(assetPath!);
    expect(asset.status()).toBe(200);
    expectSecurityHeaders(asset, `GET ${assetPath} (static asset)`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Authentication coverage: every protected route rejects requests without a valid session (spec §3).
// ---------------------------------------------------------------------------------------------------------------

/** Every route that requires a session. Kept in sync with the controllers by the source cross-check below. */
const PROTECTED_ROUTES = [
  "GET /api/auth/me",
  "GET /api/teams",
  "POST /api/teams",
  "PATCH /api/teams/:id",
  "DELETE /api/teams/:id",
  "GET /api/epics",
  "GET /api/epics/:id",
  "POST /api/epics",
  "PATCH /api/epics/:id",
  "DELETE /api/epics/:id",
  "GET /api/tickets",
  "GET /api/tickets/:id",
  "POST /api/tickets",
  "PATCH /api/tickets/:id",
  "DELETE /api/tickets/:id",
  "GET /api/tickets/:id/comments",
  "POST /api/tickets/:id/comments",
] as const;

/**
 * The only public routes (spec §3: sign-up, login, verification, resend; plus the optional health check). Logout is
 * public so that it can always clear a stale or unknown session cookie (review L3).
 */
const PUBLIC_ROUTES = [
  "POST /api/auth/register",
  "POST /api/auth/verify-email",
  "POST /api/auth/resend-verification",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/health",
] as const;

/** Reads the Nest controllers and returns "METHOD /api/path" for each route, split by @Public(). */
function routesFromControllers(): { publicRoutes: string[]; protectedRoutes: string[] } {
  const srcDir = fileURLToPath(new URL("../../apps/api/src", import.meta.url));
  const files = (readdirSync(srcDir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".controller.ts") && !f.includes("generated"))
    .map((f) => join(srcDir, f));
  const publicRoutes: string[] = [];
  const protectedRoutes: string[] = [];
  for (const file of files) {
    let prefix = "";
    let classPublic = false;
    let pendingPublic = false;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      const controller = /^@Controller\((?:"([^"]*)")?\)/.exec(line);
      const route = /^@(Get|Post|Put|Patch|Delete)\((?:"([^"]*)")?\)/.exec(line);
      if (line === "@Public()") {
        pendingPublic = true;
      } else if (controller) {
        prefix = controller[1] ?? "";
      } else if (line.startsWith("export class")) {
        classPublic = pendingPublic;
        pendingPublic = false;
      } else if (route) {
        const path = ["/api", prefix, route[2] ?? ""].filter(Boolean).join("/").replace(/\/+/g, "/");
        (classPublic || pendingPublic ? publicRoutes : protectedRoutes).push(`${route[1]!.toUpperCase()} ${path}`);
      } else if (line !== "" && !line.startsWith("@") && !line.startsWith("//") && !line.startsWith("*")) {
        pendingPublic = false; // a method signature ends the decorator block
      }
    }
  }
  return { publicRoutes: publicRoutes.sort(), protectedRoutes: protectedRoutes.sort() };
}

interface Fixture {
  team: TeamBody;
  epic: EpicBody;
  ticket: TicketBody;
}

/** Concrete path and a valid-looking JSON body for each protected route, aimed at real records. */
function requestFor(route: (typeof PROTECTED_ROUTES)[number], f: Fixture): { method: string; url: string; data?: unknown } {
  const [method, template] = route.split(" ") as [string, string];
  const id = template.startsWith("/api/teams")
    ? f.team.id
    : template.startsWith("/api/epics")
      ? f.epic.id
      : f.ticket.id;
  let url = template.replace(":id", id);
  if (method === "GET" && (url === "/api/epics" || url === "/api/tickets")) {
    url += `?teamId=${f.team.id}`;
  }
  const bodies: Partial<Record<(typeof PROTECTED_ROUTES)[number], unknown>> = {
    "POST /api/teams": { name: uniqueName("Unauthorized") },
    "PATCH /api/teams/:id": { name: uniqueName("Unauthorized") },
    "DELETE /api/teams/:id": {},
    "POST /api/epics": { teamId: f.team.id, title: "Unauthorized epic" },
    "PATCH /api/epics/:id": { title: "Unauthorized title" },
    "DELETE /api/epics/:id": {},
    "POST /api/tickets": { teamId: f.team.id, type: "bug", title: "Unauthorized ticket", body: "x" },
    "PATCH /api/tickets/:id": { state: "done", title: "Unauthorized title" },
    "DELETE /api/tickets/:id": {},
    "POST /api/tickets/:id/comments": { body: "Unauthorized comment" },
  };
  return method === "GET" ? { method, url } : { method, url, data: bodies[route] };
}

async function send(request: APIRequestContext, r: { method: string; url: string; data?: unknown }, cookie?: string) {
  // JSON content type on every request, so the CSRF middleware (415) cannot mask the guard's 401.
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
  return request.fetch(r.url, { method: r.method, headers, ...(r.data === undefined ? {} : { data: r.data }) });
}

test.describe("authentication is required on every protected route", () => {
  test("the route lists match the controllers (no route is left out)", () => {
    const { publicRoutes, protectedRoutes } = routesFromControllers();
    expect(protectedRoutes).toEqual([...PROTECTED_ROUTES].sort());
    expect(publicRoutes).toEqual([...PUBLIC_ROUTES].sort());
  });

  test("no cookie, a forged cookie or a logged-out session gets 401 and changes nothing", async ({
    request,
    playwright,
    baseURL,
  }) => {
    // Real records owned by a logged-in user, so the unauthenticated calls aim at things that exist.
    const owner = await createLoggedInUser(request);
    const team = await createTeam(request, owner.cookie);
    const epic = await createEpic(request, owner.cookie, team.id);
    const ticket = await createTicket(request, owner.cookie, team.id, { epicId: epic.id });
    await addComment(request, owner.cookie, ticket.id, "Original comment");
    const fixture: Fixture = { team, epic, ticket };

    // A real session that has been logged out.
    const revoked = await createLoggedInUser(request);
    expect((await request.post("/api/auth/logout", { data: {}, headers: { Cookie: revoked.cookie } })).status()).toBe(204);

    const credentials: [string, string | undefined][] = [
      ["no cookie", undefined],
      ["forged cookie", `${SESSION_COOKIE}=${randomBytes(32).toString("base64url")}`],
      ["empty cookie", `${SESSION_COOKIE}=`],
      ["logged-out session", revoked.cookie],
    ];
    // A separate context that never logs in: the shared `request` context keeps cookies from login responses
    // in its jar and would send them along, which would make "no cookie" meaningless.
    const anonymous = await playwright.request.newContext(baseURL ? { baseURL } : {});
    for (const [label, cookie] of credentials) {
      for (const route of PROTECTED_ROUTES) {
        const response = await send(anonymous, requestFor(route, fixture), cookie);
        expect(response.status(), `${route} with ${label}`).toBe(401);
        expect(await response.json(), `${route} with ${label}`).toEqual({
          statusCode: 401,
          message: "Authentication required",
        });
        expect(response.headers()["set-cookie"], `${route} with ${label} sets no cookie`).toBeUndefined();
      }
    }
    expect((await anonymous.storageState()).cookies).toEqual([]); // nothing was ever stored or sent implicitly
    await anonymous.dispose();

    // Nothing was created, changed or deleted.
    const teams = (await (await getJson(request, "/api/teams", owner.cookie)).json()) as TeamBody[];
    expect(teams.find((t) => t.id === team.id)).toEqual({ ...team, epicCount: 1, ticketCount: 1 });
    expect(teams.some((t) => t.name.startsWith("Unauthorized"))).toBe(false);
    expect(await (await getJson(request, `/api/epics/${epic.id}`, owner.cookie)).json()).toEqual({ ...epic, ticketCount: 1 });
    expect(await (await getJson(request, `/api/epics?teamId=${team.id}`, owner.cookie)).json()).toHaveLength(1);
    expect(await (await getJson(request, `/api/tickets/${ticket.id}`, owner.cookie)).json()).toEqual({
      ...ticket,
      commentCount: 1,
    });
    expect(await (await getJson(request, `/api/tickets?teamId=${team.id}`, owner.cookie)).json()).toHaveLength(1);
    const comments = (await (await getJson(request, `/api/tickets/${ticket.id}/comments`, owner.cookie)).json()) as {
      body: string;
    }[];
    expect(comments.map((c) => c.body)).toEqual(["Original comment"]);
  });

  test("a session token in the URL or a bearer header is not accepted", async ({ request, playwright, baseURL }) => {
    const { cookie } = await createLoggedInUser(request);
    const token = cookie.slice(`${SESSION_COOKIE}=`.length);
    // Never-logged-in context, so no cookie from the jar can authenticate these requests.
    const anonymous = await playwright.request.newContext(baseURL ? { baseURL } : {});
    expect((await anonymous.get(`/api/auth/me?${SESSION_COOKIE}=${token}`)).status()).toBe(401);
    expect((await anonymous.get(`/api/auth/me?token=${token}`)).status()).toBe(401);
    expect((await anonymous.get("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
    // The same token works only as the cookie.
    expect((await anonymous.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(200);
    expect((await anonymous.storageState()).cookies).toEqual([]);
    await anonymous.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Session cookie (D4): HttpOnly, Secure, SameSite=Lax, Path=/, 7-day absolute expiry; logout clears it.
// ---------------------------------------------------------------------------------------------------------------

function setCookieHeaders(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

function cookieAttributes(header: string): Map<string, string> {
  const [, ...attrs] = header.split(";").map((p) => p.trim());
  return new Map(attrs.map((a) => [a.split("=")[0]!.toLowerCase(), a.includes("=") ? a.slice(a.indexOf("=") + 1) : ""]));
}

test.describe("session cookie", () => {
  test("login sets one host-only HttpOnly, Secure, SameSite=Lax, Path=/ cookie that expires in 7 days", async ({
    request,
  }) => {
    const email = uniqueEmail();
    await registerAndVerify(request, email);
    const before = Date.now();
    const login = await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD });
    expect(login.status()).toBe(200);

    const headers = setCookieHeaders(login);
    expect(headers).toHaveLength(1);
    const header = headers[0]!;
    const [nameValue] = header.split(";");
    expect(nameValue).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`)); // 32 random bytes, base64url

    const attrs = cookieAttributes(header);
    expect(attrs.has("httponly")).toBe(true);
    expect(attrs.has("secure")).toBe(true); // COOKIE_SECURE defaults to true
    expect(attrs.get("samesite")).toBe("Lax");
    expect(attrs.get("path")).toBe("/");
    expect(attrs.has("domain")).toBe(false); // host-only: never sent to other hosts
    const sevenDays = 7 * 24 * 60 * 60;
    expect(Number(attrs.get("max-age"))).toBe(sevenDays);
    const expires = Date.parse(attrs.get("expires") ?? "");
    expect(expires).toBeGreaterThanOrEqual(before + sevenDays * 1000 - 5_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + sevenDays * 1000 + 5_000);
  });

  test("failed logins set no cookie", async ({ request }) => {
    const verified = uniqueEmail();
    await registerAndVerify(request, verified);
    const wrongPassword = await postJson(request, "/api/auth/login", { email: verified, password: "wrong-password" });
    expect(wrongPassword.status()).toBe(401);
    expect(setCookieHeaders(wrongPassword)).toEqual([]);

    const unverified = uniqueEmail();
    expect((await postJson(request, "/api/auth/register", { email: unverified })).status()).toBe(202);
    const notVerified = await postJson(request, "/api/auth/login", { email: unverified, password: TEST_PASSWORD });
    expect(notVerified.status()).toBe(401);
    expect(setCookieHeaders(notVerified)).toEqual([]);
  });

  test("logout expires the cookie with the same attributes and revokes the session", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const logout = await request.post("/api/auth/logout", { data: {}, headers: { Cookie: cookie } });
    expect(logout.status()).toBe(204);

    const headers = setCookieHeaders(logout);
    expect(headers).toHaveLength(1);
    expect(headers[0]!.split(";")[0]).toBe(`${SESSION_COOKIE}=`);
    const attrs = cookieAttributes(headers[0]!);
    expect(Date.parse(attrs.get("expires") ?? "")).toBeLessThan(Date.now()); // already expired
    expect(attrs.get("path")).toBe("/"); // same path, so the browser really replaces the cookie
    expect(attrs.has("httponly")).toBe(true);
    expect(attrs.has("secure")).toBe(true);
    expect(attrs.get("samesite")).toBe("Lax");

    expect((await request.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Logout (review L3): public, always 204, always clears the cookie, whatever the cookie holds. Still JSON-only (415).
// ---------------------------------------------------------------------------------------------------------------

/** Asserts a 204 logout that expires the session cookie with the attributes it was set with. */
async function expectLogoutClearsCookie(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), label).toBe(204);
  expect(await response.text(), `${label}: empty body`).toBe("");
  const headers = setCookieHeaders(response);
  expect(headers, `${label}: one Set-Cookie`).toHaveLength(1);
  expect(headers[0]!.split(";")[0], label).toBe(`${SESSION_COOKIE}=`);
  const attrs = cookieAttributes(headers[0]!);
  expect(Date.parse(attrs.get("expires") ?? ""), `${label}: already expired`).toBeLessThan(Date.now());
  expect(attrs.get("path"), label).toBe("/");
  expect(attrs.has("httponly"), label).toBe(true);
  expect(attrs.has("secure"), label).toBe(true);
  expect(attrs.get("samesite"), label).toBe("Lax");
}

function logout(request: APIRequestContext, cookie?: string): Promise<APIResponse> {
  return request.post("/api/auth/logout", {
    data: {},
    headers: { "Content-Type": "application/json", ...(cookie === undefined ? {} : { Cookie: cookie }) },
  });
}

test.describe("logout always clears the session cookie", () => {
  test("valid session: revoked server-side and cleared; the user's other sessions stay valid", async ({ request }) => {
    const email = uniqueEmail();
    await registerAndVerify(request, email);
    const first = sessionCookieFrom(await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD }));
    const second = sessionCookieFrom(await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD }));

    await expectLogoutClearsCookie(await logout(request, first), "valid session");
    expect((await request.get("/api/auth/me", { headers: { Cookie: first } })).status()).toBe(401);
    expect((await request.get("/api/auth/me", { headers: { Cookie: second } })).status()).toBe(200);
  });

  test("stale session (already logged out): 204 and cleared", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    await expectLogoutClearsCookie(await logout(request, cookie), "first logout");
    await expectLogoutClearsCookie(await logout(request, cookie), "stale session");
    expect((await request.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(401);
  });

  test("invalid or unknown session cookies: 204 and cleared; other sessions are not affected", async ({ request }) => {
    const owner = await createLoggedInUser(request);
    const invalid: [string, string][] = [
      ["unknown token", `${SESSION_COOKIE}=${randomBytes(32).toString("base64url")}`],
      ["empty value", `${SESSION_COOKIE}=`],
      ["malformed value", `${SESSION_COOKIE}=%%%not-a-token`],
      ["oversized value", `${SESSION_COOKIE}=${"x".repeat(4000)}`],
      ["the stored hash instead of the token", `${SESSION_COOKIE}=${createHash("sha256").update(owner.cookie.split("=")[1]!).digest("hex")}`],
    ];
    for (const [label, cookie] of invalid) {
      await expectLogoutClearsCookie(await logout(request, cookie), label);
    }
    expect((await request.get("/api/auth/me", { headers: { Cookie: owner.cookie } })).status()).toBe(200);
  });

  test("missing session cookie: 204 and cleared", async ({ playwright, baseURL }) => {
    // A context that never logged in, so no cookie can be sent implicitly.
    const anonymous = await playwright.request.newContext(baseURL ? { baseURL } : {});
    await expectLogoutClearsCookie(await logout(anonymous), "no Cookie header");
    await expectLogoutClearsCookie(await logout(anonymous, "theme=dark; other=1"), "only unrelated cookies");
    expect((await anonymous.storageState()).cookies).toEqual([]);
    await anonymous.dispose();
  });

  test("non-JSON logout is rejected with 415 and does not revoke or clear the session", async ({
    request,
    playwright,
    baseURL,
  }) => {
    const { cookie } = await createLoggedInUser(request);
    const anonymous = await playwright.request.newContext(baseURL ? { baseURL } : {});
    const attempts: [string, Record<string, string>, string | undefined][] = [
      ["text/plain body", { "Content-Type": "text/plain" }, "{}"],
      ["form body", { "Content-Type": "application/x-www-form-urlencoded" }, "a=1"],
      ["no content type", {}, undefined],
    ];
    for (const [label, headers, data] of attempts) {
      const response = await anonymous.fetch("/api/auth/logout", {
        method: "POST",
        headers: { ...headers, Cookie: cookie },
        ...(data === undefined ? {} : { data }),
      });
      expect(response.status(), label).toBe(415);
      expect(await response.json(), label).toMatchObject({ statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
      expect(setCookieHeaders(response), `${label}: no Set-Cookie`).toEqual([]);
    }
    await anonymous.dispose();
    expect((await request.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Session tokens are never exposed outside the Set-Cookie header (spec §9). Verification tokens may be in the link.
// ---------------------------------------------------------------------------------------------------------------

/** Forms in which a session token could leak: raw, URL-encoded, and its stored SHA-256 hash. */
function tokenForms(token: string): string[] {
  return [token, encodeURIComponent(token), createHash("sha256").update(token, "utf8").digest("hex")];
}

function expectNoToken(text: string, token: string, where: string): void {
  for (const form of tokenForms(token)) {
    expect(text.includes(form), `${where} must not contain the session token`).toBe(false);
  }
}

test.describe("session token exposure", () => {
  test("the token appears only in Set-Cookie: not in bodies, other headers, redirects or the verification link", async ({
    request,
  }) => {
    const email = uniqueEmail();
    expect((await postJson(request, "/api/auth/register", { email })).status()).toBe(202);
    const link = await getVerificationLink(email);
    const verificationToken = tokenFromLink(link);

    // The verification link carries exactly one query parameter: the single-use verification token (allowed).
    const linkUrl = new URL(link);
    expect(linkUrl.pathname).toBe("/verify-email");
    expect([...linkUrl.searchParams.keys()]).toEqual(["token"]);
    const verify = await postJson(request, "/api/auth/verify-email", { token: verificationToken, password: TEST_PASSWORD });
    expect(verify.status()).toBe(200);
    expect(setCookieHeaders(verify)).toEqual([]); // verification does not log in

    const login = await postJson(request, "/api/auth/login", { email, password: TEST_PASSWORD });
    expect(login.status()).toBe(200);
    const cookie = sessionCookieFrom(login);
    const token = cookie.slice(`${SESSION_COOKIE}=`.length);

    // Session and verification tokens are different values; the emailed link never contains the session token.
    expect(token).not.toBe(verificationToken);
    expectNoToken(link, token, "verification link");

    // Login: only Set-Cookie carries it; no redirect.
    expectNoToken(await login.text(), token, "login body");
    for (const h of login.headersArray().filter((x) => x.name.toLowerCase() !== "set-cookie")) {
      expectNoToken(h.value, token, `login header ${h.name}`);
    }
    expect(login.headers()["location"]).toBeUndefined();

    // Authenticated responses, including /me, never echo it (and set no new cookie).
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id, { epicId: epic.id });
    await addComment(request, cookie, ticket.id);
    for (const path of [
      "/api/auth/me",
      "/api/teams",
      `/api/epics?teamId=${team.id}`,
      `/api/epics/${epic.id}`,
      `/api/tickets?teamId=${team.id}`,
      `/api/tickets/${ticket.id}`,
      `/api/tickets/${ticket.id}/comments`,
    ]) {
      const response = await getJson(request, path, cookie);
      expect(response.status(), path).toBe(200);
      expectNoToken(await response.text(), token, `GET ${path} body`);
      for (const h of response.headersArray()) {
        expectNoToken(h.value, token, `GET ${path} header ${h.name}`);
      }
      expect(setCookieHeaders(response), `GET ${path} sets no cookie`).toEqual([]);
    }

    // Logout clears the cookie without echoing the token.
    const logout = await request.post("/api/auth/logout", { data: {}, headers: { Cookie: cookie } });
    expect(logout.status()).toBe(204);
    for (const h of logout.headersArray()) {
      expectNoToken(h.value, token, `logout header ${h.name}`);
    }
  });
});
