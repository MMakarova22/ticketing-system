import type { Locator, Page } from "@playwright/test";
import { createEpic, createTeam, type TeamBody, uniqueName } from "../support/api.ts";
import { sessionCookie } from "../support/board.ts";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Teams page (UI redesign step 6, phase 2): hidden h1, header, table that scrolls inside its panel, row actions,
// field-level validation (useFieldError) next to server errors, and focus management. CRUD and 409 rules themselves
// are covered by teams.spec.ts.
//
// Every user sees every team, and a long-lived test database holds thousands. Most tests therefore show only their own
// teams: the GET /api/teams response is filtered in the browser (the data and all writes stay real). This keeps the
// tests independent of data volume; the unfiltered page is covered by teams.spec.ts and the last test here.

const HINT = "Delete is disabled while a team contains tickets or epics.";

/** Shows only the teams whose name starts with `prefix` on the Teams page (and everywhere else in this page). */
async function onlyTeams(page: Page, prefix: string) {
  await page.route("**/api/teams", async (route) => {
    if (route.request().method() !== "GET") {
      return route.fallback();
    }
    const response = await route.fetch();
    const teams = (await response.json()) as TeamBody[];
    await route.fulfill({ response, json: teams.filter((team) => team.name.startsWith(prefix)) });
  });
}

async function setUp(page: Page, names: string[], options: { withEpic?: string[] } = {}) {
  await loginAsNewUser(page);
  const cookie = await sessionCookie(page);
  const prefix = uniqueName("Teams page");
  const teams: Record<string, TeamBody> = {};
  for (const name of names) {
    teams[name] = await createTeam(page.request, cookie, `${prefix} ${name}`);
  }
  for (const name of options.withEpic ?? []) {
    await createEpic(page.request, cookie, teams[name]!.id);
  }
  await onlyTeams(page, prefix);
  await page.goto("/teams");
  await expect(page.getByTestId("team-row")).toHaveCount(names.length);
  return { prefix, teams, row: (name: string) => page.getByTestId("team-row").filter({ hasText: `${prefix} ${name}` }) };
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

const createButton = (page: Page) => page.getByRole("button", { name: "Create team", exact: true });
/** The row being renamed (its name is then the value of the text field, not row text). */
const editingRow = (page: Page) =>
  page.getByTestId("team-row").filter({ has: page.getByRole("textbox", { name: "Team name" }) });

test.describe("Teams page", () => {
  test("hidden h1, intro, Create team with an icon, the Delete note above the table, row actions", async ({ page }) => {
    const { row } = await setUp(page, ["Empty", "Busy"], { withEpic: ["Busy"] });
    const h1 = page.getByRole("heading", { level: 1, name: "Teams", exact: true });
    await expect(h1).toHaveClass(/visually-hidden/);
    await expect(page.getByText("All verified users can view and manage all teams.")).toBeVisible();
    await expect(createButton(page)).toBeVisible();
    await expect(createButton(page).locator("svg")).toHaveAttribute("aria-hidden", "true");

    // The note is above the table, and disabled Delete buttons are described by it.
    const note = page.getByText(HINT);
    const table = page.getByRole("table", { name: "Teams" });
    expect((await note.boundingBox())!.y).toBeLessThan((await table.boundingBox())!.y);
    const busyDelete = row("Busy").getByRole("button", { name: "Delete" });
    await expect(busyDelete).toBeDisabled();
    await expect(busyDelete).toHaveAccessibleDescription(HINT);
    const emptyDelete = row("Empty").getByRole("button", { name: "Delete" });
    await expect(emptyDelete).toBeEnabled();
    await expect(emptyDelete).not.toHaveAttribute("aria-describedby", /.*/);
    await expect(emptyDelete).toHaveClass(/button-danger-subtle/);
    await expect(row("Empty").getByRole("button", { name: "Edit" })).toHaveClass(/button-secondary/);

    // Columns unchanged: Name, Tickets, Epics, Modified, Actions.
    await expect(table.locator("th")).toHaveText(["Name", "Tickets", "Epics", "Modified", "Actions"]);
    await expect(row("Busy").getByRole("cell").nth(2)).toHaveText("1");
  });

  for (const width of [390, 768, 1280]) {
    test(`layout at ${width} px: the page never scrolls sideways; the table scrolls inside its panel`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { row } = await setUp(page, ["A rather long team name that has to wrap somewhere", "Short"]);
      const scroller = page.locator(".table-scroll");
      const overflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBe(0);
      const scroll = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      const actions = row("Short").locator("td.actions");
      if (width === 390) {
        expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
        // The Actions column stays pinned at the right edge, also after scrolling sideways.
        const right = async () => Math.round((await actions.boundingBox())!.x + (await actions.boundingBox())!.width);
        const edge = Math.round((await scroller.boundingBox())!.x + (await scroller.boundingBox())!.width);
        expect(await right()).toBe(edge);
        await scroller.evaluate((el) => (el.scrollLeft = 120));
        expect(await right()).toBe(edge);
        await scroller.evaluate((el) => (el.scrollLeft = 0));
      } else {
        expect(scroll.scrollWidth).toBe(scroll.clientWidth);
        expect(await css(actions, "position")).toBe("static");
      }
      // Renaming fits too: the field and its message stay left of the actions.
      await row("Short").getByRole("button", { name: "Edit" }).click();
      const input = page.getByRole("textbox", { name: "Team name" });
      await input.fill(" ");
      await editingRow(page).getByRole("button", { name: "Save" }).click();
      const message = editingRow(page).locator(".field-error");
      await expect(message).toHaveText("Enter a team name.");
      const save = editingRow(page).getByRole("button", { name: "Save" });
      expect((await input.boundingBox())!.x + (await input.boundingBox())!.width).toBeLessThanOrEqual(
        (await save.boundingBox())!.x,
      );
      expect(await overflow()).toBe(0);
    });
  }

  test("create: a blank name is a field error at the input, with focus; typing clears it", async ({ page }) => {
    await setUp(page, ["Existing"]);
    await createButton(page).click();
    const form = page.getByRole("form", { name: "Create team" });
    const input = form.getByLabel("Team name");
    await expect(input).toBeFocused();
    await form.getByRole("button", { name: "Create", exact: true }).click();

    const message = form.getByRole("alert");
    await expect(message).toHaveText("Enter a team name.");
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("Enter a team name.");
    const messageId = await message.getAttribute("id");
    await expect(input).toHaveAttribute("aria-describedby", messageId!);
    // The message is outside the label, so it is not part of the field's name.
    await expect(input).toHaveAccessibleName("Team name");

    // The same error again: a new alert element (announced again), focus stays.
    const first = await message.elementHandle();
    await input.press("Enter");
    await expect(form.getByRole("alert")).toHaveText("Enter a team name.");
    expect(await first!.evaluate((el) => el.isConnected)).toBe(false);
    await expect(input).toBeFocused();

    // Typing clears the error.
    await input.fill("x");
    await expect(input).not.toHaveAttribute("aria-invalid", /.*/);
    await expect(input).not.toHaveAttribute("aria-describedby", /.*/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("create: a duplicate name (409) is one form-level alert; focus does not move; then a blank name", async ({
    page,
  }) => {
    const { prefix } = await setUp(page, ["Taken"]);
    await createButton(page).click();
    const form = page.getByRole("form", { name: "Create team" });
    const input = form.getByLabel("Team name");
    const submit = form.getByRole("button", { name: "Create", exact: true });
    await input.fill(`${prefix} TAKEN`);
    await submit.click();
    await expect(page.getByRole("alert")).toHaveText("A team with this name already exists");
    await expect(submit).toBeFocused();
    await expect(input).not.toHaveAttribute("aria-invalid", /.*/);

    // A blank name now: the server alert goes away, the field error appears (never two alerts at once).
    await input.fill("   ");
    await submit.click();
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveText("Enter a team name.");
    await expect(input).toBeFocused();
  });

  test("focus returns: Cancel and create go back to Create team", async ({ page }) => {
    const { prefix } = await setUp(page, ["One"]);
    await createButton(page).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(createButton(page)).toBeFocused();

    await createButton(page).click();
    await page.getByLabel("Team name").fill(`${prefix} Two`);
    await page.getByLabel("Team name").press("Enter");
    await expect(page.getByRole("status")).toHaveText(`Team "${prefix} Two" created.`);
    await expect(createButton(page)).toBeFocused();
  });

  test("focus returns: rename Cancel and Save go back to the row's Edit; a blank name is a field error", async ({
    page,
  }) => {
    const { prefix, row } = await setUp(page, ["Before"]);
    await row("Before").getByRole("button", { name: "Edit" }).click();
    const input = page.getByRole("textbox", { name: "Team name" });
    await expect(input).toBeFocused();
    await editingRow(page).getByRole("button", { name: "Cancel" }).click();
    await expect(row("Before").getByRole("button", { name: "Edit" })).toBeFocused();

    await row("Before").getByRole("button", { name: "Edit" }).click();
    await input.fill("  ");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Enter a team name.");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("Enter a team name.");

    await input.fill(`${prefix} After`);
    await expect(input).not.toHaveAttribute("aria-invalid", /.*/);
    await editingRow(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(`Team "${prefix} After" saved.`);
    await expect(row("After").getByRole("button", { name: "Edit" })).toBeFocused();
  });

  test("row server errors: a failed rename or delete is one alert in the row; focus stays on its button", async ({
    page,
  }) => {
    const { prefix, row } = await setUp(page, ["Row"]);
    await page.route("**/api/teams/*", (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        return route.fulfill({ status: 500, json: { statusCode: 500, message: "Rename failed" } });
      }
      if (method === "DELETE") {
        return route.fulfill({ status: 409, json: { statusCode: 409, message: "Team is in use", code: "TEAM_IN_USE" } });
      }
      return route.fallback();
    });

    await row("Row").getByRole("button", { name: "Edit" }).click();
    await page.getByRole("textbox", { name: "Team name" }).fill(`${prefix} Renamed`);
    const save = editingRow(page).getByRole("button", { name: "Save" });
    await save.click();
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(editingRow(page).getByRole("alert")).toHaveText("Rename failed");
    await expect(save).toBeFocused();
    await editingRow(page).getByRole("button", { name: "Cancel" }).click();

    page.once("dialog", (dialog) => void dialog.accept());
    const remove = row("Row").getByRole("button", { name: "Delete" });
    await remove.click();
    await expect(row("Row").getByRole("alert")).toHaveText("Team is in use");
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(remove).toBeFocused();
  });

  test("focus after a delete: the next row's Edit, else the previous one's, else Create team", async ({ page }) => {
    const { prefix, row } = await setUp(page, ["A", "B", "C"]);
    page.on("dialog", (dialog) => void dialog.accept());

    await row("B").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText(`Team "${prefix} B" deleted.`);
    await expect(row("C").getByRole("button", { name: "Edit" })).toBeFocused();

    await row("C").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText(`Team "${prefix} C" deleted.`);
    await expect(row("A").getByRole("button", { name: "Edit" })).toBeFocused();

    await row("A").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText(`Team "${prefix} A" deleted.`);
    await expect(page.getByText("No teams yet.")).toBeVisible();
    await expect(createButton(page)).toBeFocused();
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
      test.use({ colorScheme });
      test("row actions, note, field error and form title use the theme tokens", async ({ page }) => {
        const { row } = await setUp(page, ["Colors"]);
        await page.mouse.move(0, 0);
        const del = row("Colors").getByRole("button", { name: "Delete" });
        expect(await css(del, "color")).toBe(await token(page, "--color-danger"));
        expect(await css(del, "background-color")).toBe(await token(page, "--color-surface"));
        expect(await css(page.getByText(HINT), "color")).toBe(await token(page, "--color-text-muted"));

        await createButton(page).click();
        const form = page.getByRole("form", { name: "Create team" });
        expect(await css(form.getByRole("heading", { name: "Create team" }), "font-size")).toBe("16px");
        await form.getByRole("button", { name: "Create", exact: true }).click();
        expect(await css(form.getByRole("alert"), "color")).toBe(await token(page, "--color-error-text"));
        await expect
          .poll(() => css(form.getByLabel("Team name"), "border-top-color"))
          .toBe(await token(page, "--color-error-text"));
      });
    });
  }

  test("the unfiltered page (all teams in the database) has no horizontal overflow at 390 px", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 800 });
    await loginAsNewUser(page);
    await page.goto("/teams");
    await expect(page.getByTestId("team-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
