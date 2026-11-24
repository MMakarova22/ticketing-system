import type { Locator, Page } from "@playwright/test";
import { uniqueEmail } from "../support/auth.ts";
import { expect, test } from "../support/test.ts";
import { createTeamViaUi, loginAsNewUser, openEpicsForTeam } from "../support/ui.ts";
import { uniqueName } from "../support/api.ts";

// Base UI components (UI redesign step 3), checked on real elements in both themes: focus rings, control sizes,
// alert colors, disabled buttons, tables and selects. Expected colors are read from the design tokens at runtime.

/** The computed rgb() of a CSS color token in the page's current theme. */
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

async function styles(locator: Locator, ...props: string[]): Promise<Record<string, string>> {
  return locator.evaluate(
    (el, names) => Object.fromEntries(names.map((n) => [n, getComputedStyle(el).getPropertyValue(n)])),
    props,
  );
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("inputs and buttons: 36 px controls, a visible focus ring in the focus color", async ({ page }) => {
      await page.goto("/login");
      const email = page.getByLabel("Email");
      const submit = page.getByRole("button", { name: "Log in" });
      const focus = await token(page, "--color-focus");

      expect((await email.boundingBox())!.height).toBe(36);
      expect((await submit.boundingBox())!.height).toBe(36);

      await email.focus();
      expect(await styles(email, "outline-style", "outline-width", "outline-color")).toEqual({
        "outline-style": "solid",
        "outline-width": "2px",
        "outline-color": focus,
      });
      // The border color has a 120 ms transition; wait for it to settle.
      await expect.poll(async () => (await styles(email, "border-top-color"))["border-top-color"]).toBe(focus);

      // Keyboard focus on a button (focus-visible): Tab from the password field.
      await page.getByLabel("Password").focus();
      await page.keyboard.press("Tab");
      await expect(submit).toBeFocused();
      expect(await styles(submit, "outline-style", "outline-width", "outline-color")).toEqual({
        "outline-style": "solid",
        "outline-width": "2px",
        "outline-color": focus,
      });
      expect(await styles(submit, "background-color", "color")).toEqual({
        "background-color": await token(page, "--color-accent"),
        color: await token(page, "--color-on-accent"),
      });
    });

    test("error alert uses the theme's alert tokens", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(uniqueEmail("ghost"));
      await page.getByLabel("Password").fill("wrong-password");
      await page.getByRole("button", { name: "Log in" }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toHaveText("Invalid email or password");
      expect(await styles(alert, "color", "background-color", "border-top-color")).toEqual({
        color: await token(page, "--color-error-text"),
        "background-color": await token(page, "--color-error-bg"),
        "border-top-color": await token(page, "--color-error-border"),
      });
    });

    test("disabled button: reduced opacity and a not-allowed cursor, still in the accessibility tree", async ({
      page,
    }) => {
      await page.goto("/resend-verification");
      const resend = page.getByRole("button", { name: "Resend verification email" });
      await expect(resend).toBeDisabled(); // disabled until an email is typed
      expect(await styles(resend, "opacity", "cursor")).toEqual({ opacity: "0.5", cursor: "not-allowed" });
      await page.getByLabel("Email").fill(uniqueEmail());
      await expect(resend).toBeEnabled();
      expect(await styles(resend, "opacity", "cursor")).toEqual({ opacity: "1", cursor: "pointer" });
    });
  });
}

test.describe("tables and selects", () => {
  test("table header is muted and compact; rows highlight on hover; selects use the token chevron", async ({
    page,
  }) => {
    await loginAsNewUser(page);
    const team = uniqueName("Components team");
    await createTeamViaUi(page, team);

    const header = page.getByRole("table", { name: "Teams" }).locator("th").first();
    expect(await styles(header, "color", "font-size")).toEqual({
      color: await token(page, "--color-text-muted"),
      "font-size": "12px",
    });
    const cell = page.getByTestId("team-row").filter({ hasText: team }).locator("td").first();
    await cell.hover();
    const hoverColor = await token(page, "--color-surface-hover");
    expect((await styles(cell, "background-color"))["background-color"]).toBe(hoverColor);

    await openEpicsForTeam(page, team);
    const select = page.getByRole("combobox", { name: "Team" });
    const s = await styles(select, "appearance", "background-image", "height");
    expect(s.appearance).toBe("none");
    expect(s["background-image"]).toContain("linear-gradient");
    expect(s.height).toBe("36px");
  });
});
