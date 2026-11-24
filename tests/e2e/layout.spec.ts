import type { Page } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Top navigation and account menu (UI redesign step 2).

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

/** Horizontal overflow in px of the header and of the whole page (0 = none). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    return {
      header: header ? header.scrollWidth - header.clientWidth : -1,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe("top navigation", () => {
  test("a compact bar; the active section has aria-current='page' and follows navigation", async ({ page }) => {
    await loginAsNewUser(page);
    const header = await page.getByRole("banner").boundingBox();
    expect(header!.height).toBeGreaterThanOrEqual(48);
    expect(header!.height).toBeLessThanOrEqual(52);

    const links = {
      Board: nav(page).getByRole("link", { name: "Board" }),
      Teams: nav(page).getByRole("link", { name: "Teams" }),
      Epics: nav(page).getByRole("link", { name: "Epics" }),
    };
    const expectActive = async (active: keyof typeof links) => {
      for (const [name, link] of Object.entries(links)) {
        if (name === active) await expect(link, name).toHaveAttribute("aria-current", "page");
        else await expect(link, name).not.toHaveAttribute("aria-current", /.*/);
      }
    };
    await expectActive("Board");
    await links.Teams.click();
    await expect(page).toHaveURL(/\/teams$/);
    await expectActive("Teams");
    await links.Epics.click();
    await expect(page).toHaveURL(/\/epics/);
    await expectActive("Epics");
    await page.getByRole("link", { name: "Ticket Tracker", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await expectActive("Board");
  });

  test.describe("theme toggle icon", () => {
    test.use({ colorScheme: "light" });
    test("sun in light, moon in dark", async ({ page }) => {
      await loginAsNewUser(page);
      const button = page.getByTestId("theme-toggle");
      await expect(button.locator("svg circle")).toHaveCount(1); // the sun has a circle
      await button.click();
      await expect(button).toHaveAccessibleName("Dark theme");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button.locator("svg circle")).toHaveCount(0); // the moon has none
    });
  });

  test("keyboard: Tab reaches brand, the three sections, the theme toggle and the account menu, in order", async ({
    page,
  }) => {
    await loginAsNewUser(page);
    await page.getByRole("heading", { name: "Board" }).waitFor();
    await page.locator("body").focus();
    const order = [
      page.getByRole("link", { name: "Ticket Tracker", exact: true }),
      nav(page).getByRole("link", { name: "Board" }),
      nav(page).getByRole("link", { name: "Teams" }),
      nav(page).getByRole("link", { name: "Epics" }),
      page.getByTestId("theme-toggle"),
      page.getByTestId("user-menu"),
    ];
    for (const target of order) {
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
    }
    // The toggle works from the keyboard too.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("theme-toggle")).toBeFocused();
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
  });
});

test.describe("account menu", () => {
  test("avatar initial, email in the panel; closes on outside click and Escape; Log out still works", async ({
    page,
  }) => {
    const email = await loginAsNewUser(page);
    const toggle = page.getByTestId("user-menu");
    const menu = page.locator("details.account-menu");
    const logOut = page.getByRole("button", { name: "Log out" });

    await expect(toggle).toHaveText(email); // unchanged contract: the toggle's text is the email
    await expect(toggle).toHaveAccessibleName(`Account menu, ${email}`);
    const avatar = toggle.locator(".avatar");
    await expect(avatar).toHaveAttribute("data-initial", email.charAt(0).toUpperCase());
    const letter = await avatar.evaluate((el) => getComputedStyle(el, "::before").content);
    expect(letter).toBe(`"${email.charAt(0).toUpperCase()}"`);

    // Open; the panel shows the email and Log out.
    await toggle.click();
    await expect(menu).toHaveAttribute("open", "");
    await expect(page.getByTestId("account-email")).toHaveText(email);
    await expect(logOut).toBeVisible();

    // Outside click closes it (on the page area below the header; the Board heading is visually hidden).
    await page.locator("main").click({ position: { x: 4, y: 4 } });
    await expect(menu).not.toHaveAttribute("open", /.*/);
    await expect(logOut).toBeHidden();

    // Keyboard: Enter opens, Tab reaches Log out, Escape closes and returns focus to the toggle.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(logOut).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open", /.*/);
    await expect(toggle).toBeFocused();

    // Clicking inside the panel does not close it; Log out works as before.
    await toggle.click();
    await page.getByTestId("account-email").click();
    await expect(menu).toHaveAttribute("open", "");
    await logOut.click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("responsive", () => {
  test.describe("narrow screen (390 px)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("brand mark and avatar only; all three sections usable; the header never overflows", async ({ page }) => {
      const email = await loginAsNewUser(page);
      await expect(page.locator(".topnav-brand svg")).toBeVisible();
      await expect(page.locator(".topnav-brand-text")).toBeHidden();
      await expect(page.locator(".account-email")).toBeHidden();
      await expect(page.getByTestId("user-menu").locator(".avatar")).toBeVisible();
      await expect(page.getByTestId("user-menu")).toHaveAccessibleName(`Account menu, ${email}`);

      for (const name of ["Board", "Teams", "Epics"]) {
        const box = await nav(page).getByRole("link", { name }).boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.x, name).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(390);
      }
      const toggleBox = await page.getByTestId("user-menu").boundingBox();
      expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(390);
      expect((await overflow(page)).header).toBe(0);

      await nav(page).getByRole("link", { name: "Epics" }).click();
      await expect(page).toHaveURL(/\/epics/);
      expect((await overflow(page)).header).toBe(0);
      await nav(page).getByRole("link", { name: "Teams" }).click();
      await expect(page).toHaveURL(/\/teams$/);
      expect((await overflow(page)).header).toBe(0);

      // The account panel stays on screen.
      await page.getByTestId("user-menu").click();
      const panel = await page.locator(".account-panel").boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
    });

    test("public pages: no horizontal overflow, theme toggle visible", async ({ page }) => {
      for (const path of ["/login", "/signup"]) {
        await page.goto(path);
        await expect(page.getByTestId("theme-toggle"), path).toBeVisible();
        expect(await overflow(page), path).toEqual({ header: -1, page: 0 });
      }
    });
  });

  test.describe("medium screen (768 px)", () => {
    test.use({ viewport: { width: 768, height: 900 } });

    test("full brand and email; no overflow", async ({ page }) => {
      await loginAsNewUser(page);
      await expect(page.locator(".topnav-brand-text")).toBeVisible();
      await expect(page.locator(".account-email")).toBeVisible();
      expect(await overflow(page)).toEqual({ header: 0, page: 0 });
    });
  });
});
