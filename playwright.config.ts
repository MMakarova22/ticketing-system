import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

// One random password for all test accounts, generated once per run in the runner process (which loads this file
// first) and inherited by every worker through the environment. Never logged. See tests/support/auth.ts.
process.env.TT_TEST_PASSWORD ??= randomBytes(24).toString("base64url");

// Tests run against an already running stack (default: `docker compose up --build`).
// Override the target with BASE_URL, e.g. BASE_URL=http://localhost:3100 npm test
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      // Pure unit tests of API modules (no server, no browser), e.g. the rate limiter with a fake clock.
      name: "unit",
      testDir: "./tests/unit",
    },
    {
      // Backend/API flows via Playwright's HTTP client (no browser).
      name: "api",
      testDir: "./tests/api",
    },
    {
      // UI flows in a real browser.
      name: "e2e",
      testDir: "./tests/e2e",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
