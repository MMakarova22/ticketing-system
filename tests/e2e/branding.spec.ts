import type { Page } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Branding (UI redesign step 6, phase 1): the ticket-stub logo in the top navigation and on the auth screens, and the
// favicon (SVG that follows the browser's color scheme, plus an ICO fallback). Expected colors come from the tokens.

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

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("the page links an SVG favicon and an ICO fallback; both are served", async ({ page }) => {
  await page.goto("/login");
  const icons = page.locator('link[rel="icon"]');
  await expect(icons).toHaveCount(2);
  await expect(icons.nth(0)).toHaveAttribute("href", "/favicon.ico");
  await expect(icons.nth(1)).toHaveAttribute("href", "/favicon.svg");
  await expect(icons.nth(1)).toHaveAttribute("type", "image/svg+xml");

  const svg = await page.request.get("/favicon.svg");
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  expect(await svg.text()).toContain("prefers-color-scheme: dark");

  const ico = await page.request.get("/favicon.ico");
  expect(ico.status()).toBe(200);
  expect(ico.headers()["content-type"]).toMatch(/^image\/(x-icon|vnd\.microsoft\.icon)/);
  const bytes = await ico.body();
  expect([...bytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]); // icon file with 3 images
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} color scheme`, () => {
    test.use({ colorScheme });

    test("the SVG favicon renders in this scheme's accent colors", async ({ page }) => {
      await page.goto("/login");
      const expected = colorScheme === "light" ? ["#635bdb", "#ffffff"] : ["#9189ff", "#17191f"];
      // Draw the favicon at 42 px (2 px per viewBox unit, origin 1.5) and sample the ticket body and the first bar.
      const [ticket, bar] = await page.evaluate(async () => {
        const img = new Image(42, 42);
        img.src = "/favicon.svg";
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 42;
        const context = canvas.getContext("2d")!;
        context.drawImage(img, 0, 0, 42, 42);
        const at = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
        return [at(7, 9), at(13, 17)];
      });
      for (const [actual, hex] of [
        [ticket!, expected[0]!],
        [bar!, expected[1]!],
      ] as const) {
        hexToRgb(hex).forEach((channel, i) => expect(Math.abs(actual[i]! - channel), `${hex} vs ${actual}`).toBeLessThanOrEqual(2));
      }
    });

    test("top navigation: ticket-stub mark in the accent colors, wordmark, link named Ticket Tracker", async ({ page }) => {
      await loginAsNewUser(page);
      const brand = page.getByRole("link", { name: "Ticket Tracker", exact: true });
      await expect(brand).toHaveAttribute("href", "/");
      const mark = brand.locator("svg.brand-mark");
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute("aria-hidden", "true");
      await expect(mark.locator("title")).toHaveCount(0);
      expect(await mark.evaluate((el) => el.textContent?.trim())).toBe("");
      const fill = (selector: string) => mark.locator(selector).first().evaluate((el) => getComputedStyle(el).fill);
      expect(await fill(".brand-mark-ticket")).toBe(await token(page, "--color-accent"));
      expect(await fill(".brand-mark-bar")).toBe(await token(page, "--color-on-accent"));
      await expect(mark.locator(".brand-mark-bar")).toHaveCount(3);
      await expect(brand.locator(".brand-wordmark")).toHaveText("Ticket Tracker");
      await expect(brand.locator(".brand-wordmark")).toBeVisible();
      expect(Math.round((await mark.boundingBox())!.width)).toBe(22);
    });

    test("auth screens show the same mark and the wordmark", async ({ page }) => {
      await page.goto("/login");
      const brand = page.locator(".auth-brand");
      await expect(brand.locator("svg.brand-mark")).toHaveAttribute("aria-hidden", "true");
      await expect(brand.locator(".brand-wordmark")).toHaveText("Ticket Tracker");
      const ticket = brand.locator(".brand-mark-ticket");
      expect(await ticket.evaluate((el) => getComputedStyle(el).fill)).toBe(await token(page, "--color-accent"));
    });
  });
}

test("on a phone the wordmark is hidden; the mark stays and the link keeps its name", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsNewUser(page);
  const brand = page.getByRole("link", { name: "Ticket Tracker", exact: true });
  await expect(brand.locator("svg.brand-mark")).toBeVisible();
  await expect(brand.locator(".brand-wordmark")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
