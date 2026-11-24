import type { Locator, Page } from "@playwright/test";
import { addComment, createTeam, createTicket } from "../support/api.ts";
import { sessionCookie } from "../support/board.ts";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Minimal redesign of the ticket and auth screens (UI redesign step 6, final pass): ticket title as a compact visible
// h1 (also while editing), badge/chip properties with unchanged test IDs, button variants, compact comments; auth
// screens with a compact heading, muted footer and smaller card padding on phones. Behavior is covered elsewhere.

async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

const css = (locator: Locator, prop: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("ticket details: compact visible h1 (also while editing), badge and chip, button variants, comments", async ({
      page,
    }) => {
      await loginAsNewUser(page);
      const cookie = await sessionCookie(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id, { type: "bug", state: "in_progress" });
      await addComment(page.request, cookie, ticket.id, "A compact comment");
      await page.goto(`/tickets/${ticket.id}`);

      const h1 = page.getByRole("heading", { level: 1, name: ticket.title });
      await expect(h1).toBeVisible();
      expect(await css(h1, "font-size")).toBe("20px");
      await expect(page.getByTestId("ticket-type")).toHaveText("Bug");
      await expect(page.getByTestId("ticket-type").locator(".badge")).toHaveClass(/badge-bug/);
      await expect(page.getByTestId("ticket-state")).toHaveText("In progress");
      await expect(page.getByTestId("ticket-state").locator(".chip-state")).toHaveAttribute("data-state", "in_progress");
      await expect(page.getByRole("button", { name: "Edit" })).toHaveClass(/button-secondary/);
      await expect(page.getByRole("button", { name: "Delete" })).toHaveClass(/button-danger/);
      expect(await css(page.getByRole("button", { name: "Delete" }), "background-color")).toBe(
        await token(page, "--color-danger"),
      );

      const comment = page.getByTestId("comment");
      expect(await css(comment.locator(".comment-meta"), "color")).toBe(await token(page, "--color-text-muted"));
      expect(await css(comment, "background-color")).toBe(await token(page, "--color-surface-2"));
      await expect(page.getByTestId("comment-body")).toHaveText("A compact comment");

      await page.getByRole("button", { name: "Edit" }).click();
      await expect(page.getByRole("form", { name: "Edit ticket" })).toBeVisible();
      await expect(h1).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBe(0);
    });

    test("auth screens: compact heading and muted footer text; links keep the accent", async ({ page }) => {
      for (const [path, heading] of [
        ["/login", "Log in"],
        ["/signup", "Sign up"],
        ["/resend-verification", "Resend verification email"],
        ["/verify-email", "Verification failed"],
      ] as const) {
        await page.goto(path);
        const h1 = page.getByRole("heading", { level: 1, name: heading });
        await expect(h1).toBeVisible();
        expect(await css(h1, "font-size"), path).toBe("24px");
      }
      await page.goto("/login");
      const footer = page.locator(".auth-footer").first();
      expect(await css(footer, "color")).toBe(await token(page, "--color-text-muted"));
      expect(await css(footer.getByRole("link"), "color")).toBe(await token(page, "--color-accent"));
    });
  });
}

for (const width of [390, 1280]) {
  test(`auth card at ${width} px: no overflow; smaller padding on phones`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/login", "/signup", "/resend-verification", "/verify-email"]) {
      await page.goto(path);
      await expect(page.locator(".auth-card")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        path,
      ).toBe(0);
      expect(await css(page.locator(".auth-card"), "padding-left"), path).toBe(width === 390 ? "20px" : "32px");
    }
  });
}
