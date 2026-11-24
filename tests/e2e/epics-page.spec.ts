import type { Locator, Page } from "@playwright/test";
import { createEpic, createTeam, createTicket, uniqueName } from "../support/api.ts";
import { sessionCookie } from "../support/board.ts";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Epics page (UI redesign step 6, phase 2): hidden h1, header (team selector, then Create epic), table that scrolls
// inside its panel, two-line descriptions, the create/edit panel with field-level validation (useFieldError), and focus
// management. CRUD and team rules themselves are covered by epics.spec.ts.

const HINT = "Delete is disabled while tickets reference the epic.";

async function setUp(page: Page) {
  await loginAsNewUser(page);
  const cookie = await sessionCookie(page);
  const team = await createTeam(page.request, cookie, uniqueName("Epics page"));
  return { cookie, team };
}

async function openEpics(page: Page, teamId: string) {
  await page.goto(`/epics?teamId=${teamId}`);
  await expect(page.getByRole("combobox", { name: "Team" })).toHaveValue(teamId);
}

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
const createButton = (page: Page) => page.getByRole("button", { name: "Create epic", exact: true });
const row = (page: Page, title: string) => page.getByTestId("epic-row").filter({ hasText: title });

test.describe("Epics page", () => {
  test("hidden h1; Team selector then Create epic, in visual and focus order; Delete note and styles", async ({
    page,
  }) => {
    const { cookie, team } = await setUp(page);
    const used = await createEpic(page.request, cookie, team.id, uniqueName("Used"));
    await createTicket(page.request, cookie, team.id, { epicId: used.id });
    const free = await createEpic(page.request, cookie, team.id, uniqueName("Free"));
    await openEpics(page, team.id);

    await expect(page.getByRole("heading", { level: 1, name: "Epics", exact: true })).toHaveClass(/visually-hidden/);
    const select = page.getByRole("combobox", { name: "Team" });
    await expect(page.locator(".team-select > span")).toHaveClass(/visually-hidden/);
    await expect(createButton(page).locator("svg")).toHaveAttribute("aria-hidden", "true");
    const [s, b] = [(await select.boundingBox())!, (await createButton(page).boundingBox())!];
    expect(b.x).toBeGreaterThan(s.x + s.width);
    expect(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(1);
    await select.focus();
    await page.keyboard.press("Tab");
    await expect(createButton(page)).toBeFocused();

    const usedDelete = row(page, used.title).getByRole("button", { name: "Delete" });
    await expect(usedDelete).toBeDisabled();
    await expect(usedDelete).toHaveAccessibleDescription(HINT);
    await expect(row(page, free.title).getByRole("button", { name: "Delete" })).toHaveClass(/button-danger-subtle/);
    await expect(page.getByRole("table", { name: "Epics" }).locator("th")).toHaveText([
      "Title",
      "Tickets",
      "Modified",
      "Actions",
    ]);
  });

  for (const width of [390, 768, 1280]) {
    test(`layout at ${width} px: no page overflow; header on one row; long descriptions use at most two lines`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { cookie, team } = await setUp(page);
      const longText = `${"A long description that keeps going ".repeat(8)}end`.slice(0, 300);
      const epic = await createEpic(page.request, cookie, team.id, uniqueName("Long"), longText);
      await openEpics(page, team.id);

      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const select = page.getByRole("combobox", { name: "Team" });
      const [s, b] = [(await select.boundingBox())!, (await createButton(page).boundingBox())!];
      expect(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(1); // one header row

      const description = row(page, epic.title).locator(".description");
      await expect(description).toHaveAttribute("title", longText);
      // At most two lines (a line is about 1.2–1.5 × the font size) and the rest clipped.
      const lines = await description.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
        clipped: el.scrollHeight > el.clientHeight,
      }));
      expect(lines.height).toBeGreaterThan(lines.fontSize * 2);
      expect(lines.height).toBeLessThan(lines.fontSize * 3.2);
      expect(lines.clipped).toBe(true);

      const scroll = await page
        .locator(".table-scroll")
        .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      if (width === 390) {
        expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
      } else {
        expect(scroll.scrollWidth).toBe(scroll.clientWidth);
      }

      // The panel: beside the list from 900 px, below it on narrower screens.
      await row(page, epic.title).getByRole("button", { name: "Edit" }).click();
      const form = page.getByRole("form", { name: "Edit epic" });
      const list = page.locator(".split > .panel").first();
      const [f, l] = [(await form.boundingBox())!, (await list.boundingBox())!];
      if (width === 1280) {
        expect(f.x).toBeGreaterThanOrEqual(l.x + l.width);
      } else {
        expect(f.y).toBeGreaterThanOrEqual(l.y + l.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  test("create: a blank title is a field error with focus; typing clears it; Cancel returns to Create epic", async ({
    page,
  }) => {
    const { team } = await setUp(page);
    await openEpics(page, team.id);
    await createButton(page).click();
    const form = page.getByRole("form", { name: "Create epic" });
    const title = form.getByLabel("Title");
    await expect(title).toBeFocused();
    await expect(form).toContainText(`Team: ${team.name}`);
    await form.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(form.getByRole("alert")).toHaveText("Enter an epic title.");
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(title).toHaveAccessibleDescription("Enter an epic title.");
    await expect(title).toHaveAccessibleName("Title");

    const first = await form.getByRole("alert").elementHandle();
    await title.press("Enter");
    await expect(form.getByRole("alert")).toHaveText("Enter an epic title.");
    expect(await first!.evaluate((el) => el.isConnected)).toBe(false);

    await title.fill("Something");
    await expect(title).not.toHaveAttribute("aria-invalid", /.*/);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toHaveCount(0);
    await expect(createButton(page)).toBeFocused();
  });

  test("a server error is one form-level alert without moving focus; then a successful create returns focus", async ({
    page,
  }) => {
    const { team } = await setUp(page);
    await openEpics(page, team.id);
    await createButton(page).click();
    const form = page.getByRole("form", { name: "Create epic" });
    const submit = form.getByRole("button", { name: "Create", exact: true });
    await page.route("**/api/epics", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { statusCode: 500, message: "Internal server error" } })
        : route.fallback(),
    );
    const title = uniqueName("Planned");
    await form.getByLabel("Title").fill(title);
    await submit.click();
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(form.getByRole("alert")).toHaveText("Internal server error");
    await expect(submit).toBeFocused();
    await expect(form.getByLabel("Title")).not.toHaveAttribute("aria-invalid", /.*/);

    await page.unroute("**/api/epics");
    await submit.click();
    await expect(page.getByRole("status")).toHaveText(`Epic "${title}" created.`);
    await expect(createButton(page)).toBeFocused();
    await expect(row(page, title)).toBeVisible();
  });

  test("edit: Save and Cancel return to the row's Edit; the team stays read-only", async ({ page }) => {
    const { cookie, team } = await setUp(page);
    const epic = await createEpic(page.request, cookie, team.id, uniqueName("Edit me"));
    await openEpics(page, team.id);
    const edit = () => row(page, epic.title).getByRole("button", { name: "Edit" });

    await edit().click();
    const form = page.getByRole("form", { name: "Edit epic" });
    await expect(form).toContainText(`Team: ${team.name} (an epic's team cannot be changed)`);
    await expect(form.getByRole("combobox")).toHaveCount(0);
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(edit()).toBeFocused();

    await edit().click();
    await form.getByLabel("Description (optional)").fill("Now with a description");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(`Epic "${epic.title}" saved.`);
    await expect(edit()).toBeFocused();
  });

  test("focus after a delete: the next row's Edit, else Create epic; a team change closes the panel", async ({
    page,
  }) => {
    const { cookie, team } = await setUp(page);
    const other = await createTeam(page.request, cookie, uniqueName("Epics other"));
    const a = await createEpic(page.request, cookie, team.id, "A epic");
    const b = await createEpic(page.request, cookie, team.id, "B epic");
    await openEpics(page, team.id);
    page.on("dialog", (dialog) => void dialog.accept());

    await row(page, a.title).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText(`Epic "${a.title}" deleted.`);
    await expect(row(page, b.title).getByRole("button", { name: "Edit" })).toBeFocused();
    await row(page, b.title).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No epics for this team yet.")).toBeVisible();
    await expect(createButton(page)).toBeFocused();

    // Changing the team closes the panel; focus stays on the selector; the team is in the URL.
    await createButton(page).click();
    await expect(page.getByRole("form", { name: "Create epic" })).toBeVisible();
    const select = page.getByRole("combobox", { name: "Team" });
    await select.focus(); // as a person choosing a team has
    await select.selectOption(other.id);
    await expect(page.getByRole("form", { name: "Create epic" })).toHaveCount(0);
    await expect(select).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`teamId=${other.id}`));
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
      test.use({ colorScheme });
      test("row actions, description, panel title and field error use the theme tokens", async ({ page }) => {
        const { cookie, team } = await setUp(page);
        const epic = await createEpic(page.request, cookie, team.id, uniqueName("Colors"), "Described");
        await openEpics(page, team.id);
        await page.mouse.move(0, 0);
        const del = row(page, epic.title).getByRole("button", { name: "Delete" });
        expect(await css(del, "color")).toBe(await token(page, "--color-danger"));
        expect(await css(row(page, epic.title).locator(".description"), "color")).toBe(
          await token(page, "--color-text-muted"),
        );
        await row(page, epic.title).getByRole("button", { name: "Edit" }).click();
        const form = page.getByRole("form", { name: "Edit epic" });
        expect(await css(form, "background-color")).toBe(await token(page, "--color-surface"));
        expect(await css(form.getByRole("heading", { name: "Edit epic" }), "font-size")).toBe("16px");
        await form.getByLabel("Title").fill("");
        await form.getByRole("button", { name: "Save" }).click();
        expect(await css(form.getByRole("alert"), "color")).toBe(await token(page, "--color-error-text"));
      });
    });
  }
});
