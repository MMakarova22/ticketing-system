import type { Page } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Theme (UI redesign steps 1-2): public/theme-init.js sets <html data-theme> before the app runs; the CSS tokens
// follow it. The toggle (top navigation and public pages) saves an explicit choice under localStorage "tt-theme".

const LIGHT_BG = "rgb(248, 249, 251)"; // #F8F9FB
const DARK_BG = "rgb(23, 25, 31)"; // #17191F

async function rootTheme(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.documentElement).backgroundColor,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }));
}

/** Saves a theme value before any page script runs (as a previous visit would have). */
async function saveTheme(page: Page, value: string) {
  await page.addInitScript((v) => window.localStorage.setItem("tt-theme", v), value);
}

test.describe("theme on first visit follows the operating system", () => {
  test.describe("system dark", () => {
    test.use({ colorScheme: "dark" });
    test("dark tokens apply", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
      expect(await rootTheme(page)).toEqual({ theme: "dark", background: DARK_BG, colorScheme: "dark" });
    });
  });

  test.describe("system light", () => {
    test.use({ colorScheme: "light" });
    test("light tokens apply", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
      expect(await rootTheme(page)).toEqual({ theme: "light", background: LIGHT_BG, colorScheme: "light" });
    });
  });
});

test.describe("a saved choice wins over the system setting", () => {
  test.use({ colorScheme: "dark" });

  test("saved light on a dark system stays light, across reloads", async ({ page }) => {
    await saveTheme(page, "light");
    await page.goto("/login");
    expect((await rootTheme(page)).theme).toBe("light");
    await page.reload();
    expect(await rootTheme(page)).toEqual({ theme: "light", background: LIGHT_BG, colorScheme: "light" });
  });

  test("an invalid saved value is ignored (system setting used)", async ({ page }) => {
    await saveTheme(page, "purple");
    await page.goto("/login");
    expect((await rootTheme(page)).theme).toBe("dark");
  });
});

test.describe("applied before the app runs", () => {
  test.use({ colorScheme: "dark" });

  test("the theme is set even if the application bundle never loads", async ({ page }) => {
    // Block the app's JavaScript bundle: only theme-init.js runs, so the theme cannot come from React.
    await page.route("**/assets/*.js", (route) => route.abort());
    await page.goto("/login");
    await expect.poll(async () => (await rootTheme(page)).theme).toBe("dark");
    expect((await rootTheme(page)).background).toBe(DARK_BG);
    expect(await page.locator("#root").innerHTML()).toBe(""); // the app really did not render
  });
});

/** The theme toggle: a fixed accessible name; aria-pressed says whether the dark theme is on. */
function darkToggle(page: Page) {
  return page.getByRole("button", { name: "Dark theme", exact: true });
}

async function storedTheme(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("tt-theme"));
}

test.describe("theme toggle", () => {
  test.use({ colorScheme: "light" });

  test("on the login page: fixed name, aria-pressed state, switches and persists after reload", async ({
    page,
  }) => {
    await page.goto("/login");
    const button = darkToggle(page);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toHaveAccessibleName("Dark theme");
    await expect(button).toHaveAttribute("title", "Switch to dark theme"); // tooltip shows the action
    expect(await storedTheme(page)).toBeNull(); // nothing saved yet: the system setting is used

    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveAccessibleName("Dark theme"); // the name does not change with the state
    await expect(button).toHaveAttribute("title", "Switch to light theme");
    expect(await rootTheme(page)).toEqual({ theme: "dark", background: DARK_BG, colorScheme: "dark" });
    expect(await storedTheme(page)).toBe("dark");

    await page.reload();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
    expect((await rootTheme(page)).theme).toBe("dark");

    await darkToggle(page).click();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await rootTheme(page)).toEqual({ theme: "light", background: LIGHT_BG, colorScheme: "light" });
    expect(await storedTheme(page)).toBe("light");
  });

  test("on the sign-up page too", async ({ page }) => {
    await page.goto("/signup");
    await darkToggle(page).click();
    expect((await rootTheme(page)).theme).toBe("dark");
  });

  test("the choice carries over between public and authenticated pages, both ways", async ({ page }) => {
    await page.goto("/login");
    await darkToggle(page).click();

    await loginAsNewUser(page); // fills the login form on /login, then lands on the board
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    expect((await rootTheme(page)).theme).toBe("dark");
    const navToggle = page.getByRole("banner").getByRole("button", { name: "Dark theme", exact: true });
    await expect(navToggle).toHaveAttribute("aria-pressed", "true");

    await navToggle.click();
    expect((await rootTheme(page)).theme).toBe("light");
    await page.getByRole("link", { name: "Teams", exact: true }).click();
    expect((await rootTheme(page)).theme).toBe("light");

    await page.getByTestId("user-menu").click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await rootTheme(page)).theme).toBe("light");
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("the operating-system setting is followed live until an explicit choice is made", async ({ page }) => {
    await page.goto("/login");
    expect((await rootTheme(page)).theme).toBe("light");

    await page.emulateMedia({ colorScheme: "dark" }); // the OS switches to dark
    await expect.poll(async () => (await rootTheme(page)).theme).toBe("dark");
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true"); // the toggle follows too

    await darkToggle(page).click(); // explicit choice: light
    expect(await storedTheme(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(100);
    expect((await rootTheme(page)).theme).toBe("light"); // no longer follows the OS
  });
});
