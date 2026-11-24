import type { Locator, Page } from "@playwright/test";
import { createTeam, createTicket, MISSING_ID } from "../support/api.ts";
import { openBoard, sessionCookie } from "../support/board.ts";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Shared groundwork of UI redesign step 6a: text link colors (auth pages included), compact page titles and the
// subtle danger button, in both themes. Expected colors are read from the design tokens at runtime.

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

/** Checks a text link: accent color, underline, accent-hover on hover, focus ring on keyboard focus. */
async function expectTextLink(page: Page, link: Locator) {
  await expect(link).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await css(link, "color")).toBe(await token(page, "--color-accent"));
  expect(await css(link, "text-decoration-line")).toBe("underline");
  await link.hover();
  await expect.poll(() => css(link, "color")).toBe(await token(page, "--color-accent-hover"));
  await page.mouse.move(0, 0);
  await link.focus();
  expect(await link.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  expect(await css(link, "outline-style")).toBe("solid");
  expect(await css(link, "outline-width")).toBe("2px");
  expect(await css(link, "outline-color")).toBe(await token(page, "--color-focus"));
  await link.blur();
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("text links on the public auth pages use the accent color", async ({ page }) => {
      const links: [string, string][] = [
        ["/login", "Sign up"],
        ["/login", "Resend it"],
        ["/signup", "Log in"],
        ["/resend-verification", "Log in"],
      ];
      for (const [path, name] of links) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        await expectTextLink(page, page.getByRole("link", { name, exact: true }));
      }
    });

    test("text links in the app use the accent; styled links keep their own colors", async ({ page }) => {
      await loginAsNewUser(page);
      const cookie = await sessionCookie(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id);

      await page.goto(`/tickets/${ticket.id}`);
      // "Back to board" is a quiet navigation link: muted, a chevron, no underline until hover.
      const back = page.getByRole("link", { name: "Back to board" });
      await page.mouse.move(0, 0);
      expect(await css(back, "color")).toBe(await token(page, "--color-text-muted"));
      expect(await css(back, "text-decoration-line")).toBe("none");
      await expect(back.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await page.goto(`/tickets/${MISSING_ID}`);
      await expectTextLink(page, page.getByRole("link", { name: "Go to the board" }));

      // Links styled as something else are not affected, also not on hover.
      await openBoard(page, team.id);
      await page.mouse.move(0, 0);
      const newTicket = page.getByRole("link", { name: "New ticket", exact: true });
      const brand = page.getByRole("link", { name: "Ticket Tracker" });
      const teamsNav = page.getByRole("link", { name: "Teams", exact: true });
      const cardTitle = page.getByTestId("ticket-card").getByRole("link");
      expect(await css(newTicket, "color")).toBe(await token(page, "--color-on-accent"));
      expect(await css(newTicket, "text-decoration-line")).toBe("none");
      expect(await css(brand, "color")).toBe(await token(page, "--color-text"));
      expect(await css(teamsNav, "color")).toBe(await token(page, "--color-text-muted"));
      expect(await css(cardTitle, "color")).toBe(await token(page, "--color-text"));
      await newTicket.hover();
      await expect.poll(() => css(newTicket, "background-color")).toBe(await token(page, "--color-accent-hover"));
      expect(await css(newTicket, "color")).toBe(await token(page, "--color-on-accent"));
      await brand.hover();
      expect(await css(brand, "color")).toBe(await token(page, "--color-text"));
      await teamsNav.hover();
      await expect.poll(() => css(teamsNav, "color")).toBe(await token(page, "--color-text"));
    });

    test("subtle danger button: danger text on a neutral button, error colors on hover", async ({ page }) => {
      await page.goto("/login");
      await page.evaluate(() => {
        const card = document.querySelector(".auth-card")!;
        for (const disabled of [false, true]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "button button-small button-danger-subtle";
          button.textContent = disabled ? "Probe disabled" : "Probe";
          button.disabled = disabled;
          card.append(button);
        }
      });
      const button = page.getByRole("button", { name: "Probe", exact: true });
      await page.mouse.move(0, 0);
      expect(await css(button, "color")).toBe(await token(page, "--color-danger"));
      expect(await css(button, "background-color")).toBe(await token(page, "--color-surface"));
      expect(await css(button, "border-top-color")).toBe(await token(page, "--color-border-emphasis"));
      await button.hover();
      await expect.poll(() => css(button, "background-color")).toBe(await token(page, "--color-error-bg"));
      await expect.poll(() => css(button, "color")).toBe(await token(page, "--color-error-text"));
      await expect.poll(() => css(button, "border-top-color")).toBe(await token(page, "--color-error-border"));

      const disabled = page.getByRole("button", { name: "Probe disabled" });
      await disabled.hover({ force: true });
      expect(await css(disabled, "opacity")).toBe("0.5");
      expect(await css(disabled, "background-color")).toBe(await token(page, "--color-surface"));
    });
  });
}

test("Teams and Epics keep a visually hidden h1; the ticket title is a compact, visible h1", async ({ page }) => {
  await loginAsNewUser(page);
  const cookie = await sessionCookie(page);
  const team = await createTeam(page.request, cookie);
  const ticket = await createTicket(page.request, cookie, team.id);
  const pages: [string, string][] = [
    ["/teams", "Teams"],
    [`/epics?teamId=${team.id}`, "Epics"],
  ];
  for (const [path, title] of pages) {
    await page.goto(path);
    const h1 = page.getByRole("heading", { level: 1, name: title, exact: true });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveClass(/visually-hidden/);
    expect((await h1.boundingBox())!.width).toBeLessThanOrEqual(1);
  }
  await page.goto(`/tickets/${ticket.id}`);
  const ticketTitle = page.getByRole("heading", { level: 1, name: ticket.title });
  await expect(ticketTitle).not.toHaveClass(/visually-hidden/);
  expect(await css(ticketTitle, "font-size")).toBe("20px");
});
