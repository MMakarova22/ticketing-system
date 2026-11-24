import { expect, test } from "../support/test.ts";

/**
 * Base URL of an app instance whose database is unreachable, for the 503 test. Stopping the database of the stack
 * under test would break the tests running in parallel, so this needs a separate instance (for example the app image
 * started with a DATABASE_URL that refuses connections); the test is skipped when the variable is not set.
 */
const DB_DOWN_BASE_URL = process.env.DB_DOWN_BASE_URL;

test.describe("infrastructure", () => {
  test("health endpoint reports API and database up", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok", database: "up" });
  });

  test("health endpoint returns 503 with the standard error body when the database is unavailable", async ({
    playwright,
  }) => {
    test.skip(!DB_DOWN_BASE_URL, "set DB_DOWN_BASE_URL to an app instance whose database is unreachable");
    if (!DB_DOWN_BASE_URL) {
      return;
    }
    const context = await playwright.request.newContext({ baseURL: DB_DOWN_BASE_URL });
    try {
      const response = await context.get("/api/health");
      expect(response.status()).toBe(503);
      expect(response.headers()["content-type"]).toContain("application/json");
      expect(await response.json()).toEqual({
        statusCode: 503,
        message: "Database is unavailable",
        code: "DATABASE_UNAVAILABLE",
      });
    } finally {
      await context.dispose();
    }
  });

  test("unknown API routes return a JSON 404, not the SPA", async ({ request }) => {
    const response = await request.get("/api/does-not-exist");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");
  });

  test("client-side routes are served the SPA index page", async ({ request }) => {
    const response = await request.get("/teams");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(await response.text()).toContain('<div id="root"></div>');
  });
});
