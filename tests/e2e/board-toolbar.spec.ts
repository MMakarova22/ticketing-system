import type { Locator, Page } from "@playwright/test";
import { createEpic, createTeam, createTicket, uniqueName } from "../support/api.ts";
import { sessionCookie } from "../support/board.ts";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Board toolbar (UI redesign steps 4 and 6): a visually hidden "Board" heading, then one row of controls: the
// "Board filters" search region (Team, search, Type, Epic, Clear, count) and New ticket right after it, outside the
// region. Filtering and team switching themselves are covered by board.spec.ts; this spec checks the accessibility
// contract, focus, keyboard order, responsive layout, themes and the epics error state.

async function openBoardWithTickets(page: Page) {
  await loginAsNewUser(page);
  const cookie = await sessionCookie(page);
  const team = await createTeam(page.request, cookie, uniqueName("Toolbar"));
  const epic = await createEpic(page.request, cookie, team.id, uniqueName("Epic"));
  for (const [title, type] of [["Login fails", "bug"], ["Dark mode", "feature"], ["Typo fix", "fix"]] as const) {
    await createTicket(page.request, cookie, team.id, { title, type, epicId: type === "bug" ? epic.id : null });
  }
  await page.goto(`/?teamId=${team.id}`);
  await expect(page.getByTestId("board")).toBeVisible();
  return { team, epic };
}

function controls(page: Page) {
  return {
    title: page.getByRole("heading", { name: "Board", level: 1 }),
    toolbar: page.locator(".board-toolbar"),
    filters: page.getByRole("search", { name: "Board filters" }),
    team: page.getByRole("combobox", { name: "Team" }),
    search: page.getByRole("searchbox", { name: "Search titles" }),
    type: page.getByRole("combobox", { name: "Type" }),
    epic: page.getByRole("combobox", { name: "Epic" }),
    clear: page.getByRole("button", { name: "Clear", exact: true }),
    summary: page.getByTestId("board-summary"),
    newTicket: page.getByRole("link", { name: "New ticket", exact: true }),
  };
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** Vertical centre, to check that controls share a row. */
async function middle(locator: Locator) {
  const b = await box(locator);
  return Math.round(b.y + b.height / 2);
}

/** Same row: vertical centres within 2 px (controls of different heights are aligned on the text baseline). */
async function expectSameRow(a: Locator, b: Locator, message: string) {
  expect(Math.abs((await middle(a)) - (await middle(b))), message).toBeLessThanOrEqual(2);
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

test.describe("board toolbar", () => {
  test("hidden h1, Team inside the filters region, New ticket outside it, summary contract", async ({ page }) => {
    const { team } = await openBoardWithTickets(page);
    const c = controls(page);

    // The page keeps its h1 for assistive technology, but it is not shown.
    await expect(c.title).toHaveCount(1);
    await expect(c.title).toHaveClass(/visually-hidden/);
    expect((await box(c.title)).width).toBeLessThanOrEqual(1);

    // Team scopes the search, so it is part of the "Board filters" region; New ticket is not.
    for (const control of [c.team, c.search, c.type, c.epic, c.clear, c.summary]) {
      await expect(c.filters.locator(control)).toHaveCount(1);
    }
    await expect(c.filters.getByRole("link")).toHaveCount(0);
    await expect(c.newTicket).toBeVisible();
    await expect(c.newTicket).toHaveAccessibleName("New ticket");
    await expect(c.newTicket).toHaveAttribute("href", `/tickets/new?teamId=${team.id}`);
    await expect(c.newTicket.locator("svg")).toHaveAttribute("aria-hidden", "true");
    expect(await c.newTicket.evaluate((el) => el.closest('[role="search"]'))).toBeNull();

    // Visible labels for Type and Epic; Team and Search are named by visually hidden labels.
    await expect(c.filters.getByText("Type", { exact: true })).toBeVisible();
    await expect(c.filters.getByText("Epic", { exact: true })).toBeVisible();
    for (const hidden of [page.locator(".board-team > span"), page.locator(".board-search > span")]) {
      await expect(hidden).toHaveClass(/visually-hidden/);
      expect((await box(hidden)).width).toBeLessThanOrEqual(1);
    }
    await expect(c.team.locator("option:checked")).toHaveText(team.name);

    // The count stays a polite live region and is not role="status" (dnd-kit already renders one).
    await expect(c.summary).toHaveAttribute("aria-live", "polite");
    await expect(c.summary).not.toHaveAttribute("role", /.*/);
    await expect(c.summary).toHaveText("3 tickets");
    await expect(c.clear).toBeDisabled();
  });

  test("the search input keeps focus while typing; URL and summary follow", async ({ page }) => {
    await openBoardWithTickets(page);
    const c = controls(page);
    await c.search.click();
    await page.keyboard.type("login", { delay: 60 });
    await expect(c.search).toBeFocused();
    await expect(c.search).toHaveValue("login");
    await expect(page).toHaveURL(/q=login/);
    await expect(c.summary).toHaveText("Showing 1 of 3 tickets");
    await page.keyboard.type(" fails", { delay: 60 });
    await expect(c.search).toBeFocused();
    await expect(c.search).toHaveValue("login fails");
    await expect(c.clear).toBeEnabled();
  });

  test("keyboard: Tab order is Team, search, Type, Epic, Clear, New ticket", async ({ page }) => {
    await openBoardWithTickets(page);
    const c = controls(page);
    await c.type.selectOption("bug"); // an active filter enables Clear
    await c.team.focus();
    for (const next of [c.search, c.type, c.epic, c.clear, c.newTicket]) {
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
    }
  });

  for (const width of [390, 768, 1024, 1280]) {
    test(`layout at ${width} px: no overflow, everything on screen, rows as designed`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openBoardWithTickets(page);
      const c = controls(page);
      await c.type.selectOption("bug"); // Clear enabled, so it takes part in the focus order below
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      const { title: _title, ...shown } = c;
      for (const [name, control] of Object.entries(shown)) {
        const b = await box(control);
        expect(b.x, name).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, name).toBeLessThanOrEqual(width);
      }

      // Focus order follows the visual reading order: each next control is on the same row further right, or lower.
      const focusOrder = {
        team: c.team,
        search: c.search,
        type: c.type,
        epic: c.epic,
        clear: c.clear,
        newTicket: c.newTicket,
      };
      let previous: { name: string; x: number; middle: number } | null = null;
      for (const [name, control] of Object.entries(focusOrder)) {
        const b = await box(control);
        const current = { name, x: Math.round(b.x), middle: Math.round(b.y + b.height / 2) };
        if (previous) {
          const sameRow = Math.abs(current.middle - previous.middle) <= 2;
          const inOrder = sameRow ? current.x > previous.x : current.middle > previous.middle;
          expect(inOrder, `${previous.name} → ${name}`).toBe(true);
        }
        previous = current;
      }

      // New ticket is always at the right end of the toolbar, on the last row of the filters (or below them).
      const [toolbar, newTicket, summary] = [await box(c.toolbar), await box(c.newTicket), await box(c.summary)];
      expect(Math.round(newTicket.x + newTicket.width)).toBe(Math.round(toolbar.x + toolbar.width));
      const toolbarHeight = (await box(page.getByTestId("board"))).y - toolbar.y;

      if (width === 390) {
        // Team / search (full width) / Type + Epic / Clear + count / New ticket.
        expect((await box(c.team)).width).toBeGreaterThan(width * 0.8);
        expect((await box(c.search)).width).toBeGreaterThan(width * 0.8);
        expect(await middle(c.search)).toBeGreaterThan(await middle(c.team));
        await expectSameRow(c.type, c.epic, "Type and Epic");
        expect(await middle(c.type)).toBeGreaterThan(await middle(c.search));
        await expectSameRow(c.clear, c.summary, "Clear and count");
        expect(await middle(c.clear)).toBeGreaterThan(await middle(c.type));
        expect(newTicket.y).toBeGreaterThanOrEqual(summary.y + summary.height);
        expect(toolbarHeight).toBeLessThan(260); // the toolbar alone was 253 px with the visible title
      } else {
        // Team and search start the first row; New ticket shares the last row with the count.
        await expectSameRow(c.team, c.search, "Team and search");
        await expectSameRow(c.newTicket, c.summary, "New ticket and count");
        if (width === 1280) {
          // Everything on one row.
          for (const control of [c.type, c.epic, c.clear, c.summary, c.newTicket]) {
            await expectSameRow(control, c.team, "one row at 1280 px");
          }
          expect(toolbarHeight).toBeLessThan(120); // was 185 px (title row + filter row)
        }
      }
    });
  }

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
      test.use({ colorScheme });
      test("toolbar colors come from the theme tokens", async ({ page }) => {
        await openBoardWithTickets(page);
        const c = controls(page);
        const css = (locator: Locator, prop: string) =>
          locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
        expect(await css(c.toolbar, "border-bottom-color")).toBe(await token(page, "--color-border"));
        const typeLabel = c.filters.getByText("Type", { exact: true });
        expect(await css(typeLabel, "color")).toBe(await token(page, "--color-text-muted"));
        expect(await css(page.locator(".board-search-icon"), "color")).toBe(await token(page, "--color-text-muted"));
        expect(await css(c.summary, "color")).toBe(await token(page, "--color-text-muted"));
        expect(await css(c.newTicket, "background-color")).toBe(await token(page, "--color-accent"));
        expect(await css(c.newTicket, "color")).toBe(await token(page, "--color-on-accent"));
        expect(await css(c.team, "border-top-color")).toBe(await token(page, "--color-border-strong"));
      });
    });
  }

  test("epics fail to load: Epic is disabled with a visible message, also on a phone", async ({ page }) => {
    await page.route("**/api/epics?teamId=*", (route) =>
      route.fulfill({ status: 500, json: { statusCode: 500, message: "Internal server error" } }),
    );
    await openBoardWithTickets(page);
    const c = controls(page);
    const message = c.filters.getByText("Could not load epics: Internal server error");
    await expect(c.epic).toBeDisabled();
    await expect(message).toBeVisible();
    await expect(c.type).toBeEnabled(); // the other filters keep working
    await c.type.selectOption("bug");
    await expect(c.summary).toHaveText("Showing 1 of 3 tickets");

    await page.setViewportSize({ width: 390, height: 844 });
    const b = await box(message);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
