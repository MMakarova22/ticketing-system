import type { Locator, Page } from "@playwright/test";
import {
  addComment,
  createEpic,
  createTeam,
  createTicket,
  getJson,
  TICKET_STATE_VALUES,
  type TicketBody,
  type TicketStateValue,
  uniqueName,
} from "../support/api.ts";
import {
  card,
  column,
  createTickets,
  expectOverlayUnder,
  finger,
  gripPoint,
  moveCardWithKeyboard,
  openBoard,
  sessionCookie,
  STATE_LABELS,
  touchDragCardToColumn,
  touchSwipe,
  watchOverlay,
} from "../support/board.ts";
import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

// Kanban columns and ticket cards (UI redesign step 5): layout and scrolling at three widths, card anatomy, theme
// colors, drag overlay position, keyboard drag on a phone, and touch drag-and-drop (press and hold 200 ms).
// Moving tickets, filters and rollback in general are covered by board.spec.ts.

async function setUp(page: Page): Promise<string> {
  await loginAsNewUser(page);
  return sessionCookie(page);
}

async function apiState(page: Page, cookie: string, id: string): Promise<TicketStateValue> {
  const response = await getJson(page.request, `/api/tickets/${id}`, cookie);
  expect(response.status()).toBe(200);
  return ((await response.json()) as TicketBody).state;
}

function patchResponse(page: Page, id: string) {
  return page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/tickets/${id}`));
}

/** Collects every state-changing request the page sends from now on. */
function writes(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") {
      sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  return sent;
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
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

const cardList = (page: Page, state: TicketStateValue) => column(page, state).locator(".board-column-cards");

/** Grip point of a card that is fully inside the visible part of a (scrolled) card list. */
async function visibleGrip(list: Locator) {
  const point = await list.evaluate((el) => {
    const l = el.getBoundingClientRect();
    for (const c of el.querySelectorAll('[data-testid="ticket-card"]')) {
      const r = c.getBoundingClientRect();
      if (r.top >= l.top && r.bottom <= l.bottom) {
        return { x: r.left + r.width / 2, y: r.bottom - 6 };
      }
    }
    return null;
  });
  expect(point, "a fully visible card").not.toBeNull();
  return point!;
}

test.describe("board columns and cards", () => {
  for (const width of [390, 768, 1280]) {
    test(`layout at ${width} px: five columns fill the height; the board scrolls sideways only when needed`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      for (const state of TICKET_STATE_VALUES) {
        await createTicket(page.request, cookie, team.id, { state, title: uniqueName(`Card ${state}`) });
      }
      await openBoard(page, team.id);

      await expect(page.locator(".board-column-title")).toHaveText(TICKET_STATE_VALUES.map((s) => STATE_LABELS[s]));
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { overflowX: de.scrollWidth - de.clientWidth, overflowY: de.scrollHeight - de.clientHeight };
      });
      expect(overflow, "the page itself does not scroll").toEqual({ overflowX: 0, overflowY: 0 });

      // The board uses the height left below the toolbar (only the page padding remains below it).
      const board = page.getByTestId("board");
      const boardBox = await box(board);
      expect(844 - (boardBox.y + boardBox.height)).toBeLessThanOrEqual(32);
      const rounded = (values: number[]) => values.map(Math.round);
      const boxes = (of: (s: TicketStateValue) => Locator) => Promise.all(TICKET_STATE_VALUES.map((s) => box(of(s))));
      const heights = rounded((await boxes((s) => column(page, s))).map((b) => b.height));
      expect(new Set(heights).size, `column heights ${heights}`).toBe(1);
      expect(heights[0]).toBeGreaterThan(450);

      // Card lists start at the same height in every column, also when a long title wraps in the header.
      const listTops = rounded((await boxes((s) => cardList(page, s))).map((b) => b.y));
      expect(new Set(listTops).size, `list tops ${listTops}`).toBe(1);

      const scroll = await board.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      if (width === 1280) {
        expect(scroll.scrollWidth).toBe(scroll.clientWidth); // all five columns fit
      } else {
        expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
      }
      if (width === 390) {
        // About 80% of the screen per column (at most 18rem), and the next column peeks in.
        const first = await box(column(page, "new"));
        const next = await box(column(page, "ready_for_implementation"));
        expect(first.width).toBeGreaterThan(280);
        expect(first.width).toBeLessThanOrEqual(312);
        expect(width - 16 - next.x, "visible part of the next column").toBeGreaterThanOrEqual(40);
      }
    });
  }

  test("40 cards: the column scrolls on its own and the page does not grow", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 844 });
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const fields = Array.from({ length: 40 }, (_, i) => ({ title: `Tall ${String(i).padStart(2, "0")}` }));
    await createTickets(page.request, cookie, team.id, fields);
    await createTicket(page.request, cookie, team.id, { state: "done", title: "Lonely done" });
    await openBoard(page, team.id);
    await expect(column(page, "new").getByTestId("ticket-card")).toHaveCount(40);

    const list = cardList(page, "new");
    const sizes = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(sizes.scrollHeight).toBeGreaterThan(sizes.clientHeight * 3);
    const boardTop = (await box(page.getByTestId("board"))).y;
    const pageOverflowY = () =>
      page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
    expect(await pageOverflowY()).toBe(0);

    // Wheel over the column: only its list scrolls.
    await list.hover();
    await page.mouse.wheel(0, 5000);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    await expect(list.getByTestId("ticket-card").last()).toBeInViewport();
    expect((await box(page.getByTestId("board"))).y).toBe(boardTop);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await cardList(page, "done").evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("card anatomy: title link, type badge, epic, modified time, empty comment slot", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const epic = await createEpic(page.request, cookie, team.id, uniqueName("Epic"));
    const withEpic = await createTicket(page.request, cookie, team.id, {
      type: "bug",
      title: uniqueName("With epic"),
      epicId: epic.id,
    });
    const noEpic = await createTicket(page.request, cookie, team.id, { type: "fix", title: uniqueName("Plain") });
    await addComment(page.request, cookie, withEpic.id, "First");
    await addComment(page.request, cookie, withEpic.id, "Second");
    await openBoard(page, team.id);

    const a = card(page, withEpic.title);
    const link = a.getByRole("link", { name: withEpic.title, exact: true });
    await expect(link).toHaveAttribute("href", `/tickets/${withEpic.id}`);
    await expect(a.locator(".badge")).toHaveText("Bug");
    await expect(a.locator(".card-epic")).toHaveText(epic.title);
    await expect(a.locator(".card-epic")).not.toHaveClass(/muted/);
    const time = a.locator("time.card-modified");
    await expect(time).toHaveAttribute("datetime", withEpic.modifiedAt);
    await expect(time).toHaveAttribute("title", /\S/);
    await expect(time).toHaveText(/^Today \d/);

    // The comment slot is reserved space only: hidden from assistive technology, empty, with a fixed size.
    const slot = a.locator(".card-slot");
    await expect(slot).toHaveAttribute("aria-hidden", "true");
    await expect(slot).toBeEmpty();
    const slotBox = await box(slot);
    expect(Math.round(slotBox.width)).toBe(32);
    // No comment count anywhere on the card (the ticket has two comments).
    const text = (await a.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toBe(`${withEpic.title} Bug ${epic.title} ${await time.innerText()}`);

    const b = card(page, noEpic.title);
    await expect(b.locator(".badge")).toHaveText("Fix");
    await expect(b.locator(".card-epic")).toHaveText("No epic");
    await expect(b.locator(".card-epic")).toHaveClass(/muted/);

    // Accessibility contract of the card and the column heading (the state dot is decorative).
    await expect(a).toHaveAttribute("aria-label", withEpic.title);
    await expect(a).toHaveAttribute("aria-roledescription", "draggable ticket");
    await expect(a).toHaveAttribute("tabindex", "0");
    await expect(a).toHaveAttribute("aria-describedby", /\S/);
    await expect(column(page, "new").locator(".board-column-dot")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("heading", { level: 2, name: "New 2", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "New 2" })).toHaveAttribute("data-testid", "column-new");
  });

  test("keyboard: Tab reaches the cards after the toolbar; a focused card shows the focus ring", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Focus") });
    await openBoard(page, team.id);
    // The toolbar ends with New ticket (Clear is disabled while no filter is active), so the first card is next.
    await page.getByRole("link", { name: "New ticket", exact: true }).focus();
    await page.keyboard.press("Tab");
    const first = card(page, ticket.title);
    await expect(first).toBeFocused();
    expect(await css(first, "outline-style")).toBe("solid");
    expect(await css(first, "outline-width")).toBe("2px");
    expect(await css(first, "outline-color")).toBe(await token(page, "--color-focus"));
    // Tab from the card goes to its title link (Enter there opens the ticket; covered in board.spec.ts).
    await page.keyboard.press("Tab");
    await expect(first.getByRole("link")).toBeFocused();
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
      test.use({ colorScheme });
      test("board, columns, cards, state dots and the drop target use the theme tokens", async ({ page }) => {
        const cookie = await setUp(page);
        const team = await createTeam(page.request, cookie);
        const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Colors") });
        await openBoard(page, team.id);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);

        const newColumn = column(page, "new");
        // The page background (set on :root) shows through the board; columns and cards are surfaces on top of it.
        expect(await css(page.locator("html"), "background-color")).toBe(await token(page, "--color-bg"));
        expect(await css(page.getByTestId("board"), "background-color")).toBe("rgba(0, 0, 0, 0)");
        expect(await css(newColumn, "background-color")).toBe(await token(page, "--color-surface-2"));
        const c = card(page, ticket.title);
        expect(await css(c, "background-color")).toBe(await token(page, "--color-surface"));
        expect(await css(c, "border-top-color")).toBe(await token(page, "--color-border"));
        expect(await css(c.getByRole("link"), "color")).toBe(await token(page, "--color-text"));
        expect(await css(c.locator(".card-modified"), "color")).toBe(await token(page, "--color-text-muted"));
        expect(await css(newColumn.getByTestId("column-count"), "color")).toBe(await token(page, "--color-text-muted"));
        for (const state of TICKET_STATE_VALUES) {
          const dot = column(page, state).locator(".board-column-dot");
          const stateToken = `--color-state-${state.replaceAll("_", "-")}`;
          expect(await css(dot, "background-color"), state).toBe(await token(page, stateToken));
        }

        // Drop target while dragging over a column.
        const target = column(page, "in_progress");
        const from = await gripPoint(c);
        const to = await box(target);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 12, from.y + 4, { steps: 3 });
        await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 10 });
        await expect(target).toHaveClass(/board-column-over/);
        await expect.poll(() => css(target, "background-color")).toBe(await token(page, "--color-accent-subtle"));
        await expect.poll(() => css(target, "border-top-color")).toBe(await token(page, "--color-accent"));
        expect(await css(page.locator(".card-overlay"), "box-shadow")).not.toBe("none");
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.locator(".card-overlay")).toHaveCount(0);
        await expect(card(column(page, "new"), ticket.title)).toBeVisible();
      });
    });
  }

  test("390 px: the overlay starts on the card and follows the pointer with the board and column scrolled", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const fields = Array.from({ length: 20 }, (_, i) => ({ state: "in_progress", title: `Deep ${i}` }));
    await createTickets(page.request, cookie, team.id, fields);
    await openBoard(page, team.id);
    const sent = writes(page);

    // Scroll the board sideways to "In progress" and its list down, so the card's position involves both offsets.
    const target = cardList(page, "in_progress").getByTestId("ticket-card").nth(8);
    await target.scrollIntoViewIfNeeded();
    expect(await page.getByTestId("board").evaluate((el) => el.scrollLeft)).toBeGreaterThan(300);
    expect(await cardList(page, "in_progress").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    const cardBox = await box(target);
    const start = await gripPoint(target);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y + 4, { steps: 3 });
    await expect(page.locator(".card-overlay")).toBeVisible();
    const overlay = await box(page.locator(".card-overlay"));
    expect(Math.abs(overlay.x - (cardBox.x + 12))).toBeLessThanOrEqual(2);
    expect(Math.abs(overlay.y - (cardBox.y + 4))).toBeLessThanOrEqual(2);
    expect(Math.round(overlay.width)).toBe(Math.round(cardBox.width));
    for (const point of [
      { x: start.x - 40, y: start.y - 80 },
      { x: start.x + 20, y: start.y + 60 },
    ]) {
      await page.mouse.move(point.x, point.y, { steps: 5 });
      await expectOverlayUnder(page, point);
    }
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".card-overlay")).toHaveCount(0);
    expect(sent).toEqual([]);
  });

  test("390 px: keyboard drag to an off-screen column persists", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Phone keys") });
    await openBoard(page, team.id);
    await expect(column(page, "done")).not.toBeInViewport({ ratio: 0.5 });

    const patched = patchResponse(page, ticket.id);
    await moveCardWithKeyboard(page, card(page, ticket.title), 4, column(page, "done"));
    expect((await patched).status()).toBe(200);
    // The keyboard sensor scrolled the board along, so the target column is on screen.
    await expect(column(page, "done")).toBeInViewport({ ratio: 0.5 });
    await expect(card(column(page, "done"), ticket.title)).toBeAttached();
    await page.reload();
    await expect(card(column(page, "done"), ticket.title)).toBeAttached();
    expect(await apiState(page, cookie, ticket.id)).toBe("done");
  });

  test("mouse: no press-and-hold pick-up; the 5 px distance still applies", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Mouse") });
    await openBoard(page, team.id);
    const sent = writes(page);
    const start = await gripPoint(card(page, ticket.title));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForTimeout(400); // longer than the touch delay
    await expect(page.locator(".card-overlay")).toHaveCount(0);
    await page.mouse.move(start.x + 3, start.y);
    await expect(page.locator(".card-overlay")).toHaveCount(0);
    await page.mouse.move(start.x + 8, start.y);
    await expect(page.locator(".card-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".card-overlay")).toHaveCount(0);
    expect(sent).toEqual([]);
  });
});

test.describe("touch drag-and-drop (press and hold 200 ms)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "touch input goes through the Chromium DevTools protocol");
  test.use({ hasTouch: true });

  test("press and hold, then drag: the overlay stays under the finger and the move persists", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Touch") });
    await openBoard(page, team.id);

    const patched = patchResponse(page, ticket.id);
    await touchDragCardToColumn(page, card(page, ticket.title), column(page, "in_progress"));
    expect((await patched).status()).toBe(200);
    await expect(card(column(page, "in_progress"), ticket.title)).toBeVisible();
    await page.reload();
    await expect(card(column(page, "in_progress"), ticket.title)).toBeVisible();
    expect(await apiState(page, cookie, ticket.id)).toBe("in_progress");
  });

  test("390 px: a short touch does not pick the card up; quick swipes scroll the column and the board", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const fields = Array.from({ length: 40 }, (_, i) => ({ title: `Swipe ${String(i).padStart(2, "0")}` }));
    await createTickets(page.request, cookie, team.id, fields);
    await openBoard(page, team.id);
    const sent = writes(page);
    const overlaySeen = await watchOverlay(page);

    // Held for less than 200 ms without moving: no pick-up.
    const f = await finger(page);
    const grip = await gripPoint(page.getByTestId("ticket-card").first());
    await f.down(grip);
    await page.waitForTimeout(120);
    await f.up();

    // Vertical swipe over the cards scrolls the column list (not the page).
    const list = cardList(page, "new");
    await touchSwipe(page, await gripPoint(list.getByTestId("ticket-card").nth(3)), 0, -30);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Horizontal swipe over a card scrolls the board sideways.
    const board = page.getByTestId("board");
    await touchSwipe(page, await visibleGrip(list), -25, 0);
    await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

    expect(await overlaySeen(), "the drag overlay never appeared").toBe(false);
    expect(sent).toEqual([]);
  });

  test("390 px: a long press shows the overlay under the finger; dropping on the own column sends nothing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Hold") });
    await openBoard(page, team.id);
    const sent = writes(page);

    const f = await finger(page);
    const start = await gripPoint(card(page, ticket.title));
    await f.down(start);
    await page.waitForTimeout(120);
    await expect(page.locator(".card-overlay")).toHaveCount(0); // not before 200 ms
    await page.waitForTimeout(180);
    await expect(page.locator(".card-overlay")).toBeVisible();
    // Steps beyond Chromium's touch slop (about 15 px): smaller first moves are not delivered, as on phones.
    for (let i = 1; i <= 4; i += 1) {
      const point = { x: start.x + i * 10, y: start.y + i * 20 };
      await f.move(point);
      await expectOverlayUnder(page, point);
    }
    expect(await page.evaluate(() => window.scrollY), "no page scroll during the drag").toBe(0);
    await f.up();
    await expect(page.locator(".card-overlay")).toHaveCount(0);
    await expect(card(column(page, "new"), ticket.title)).toBeVisible();
    expect(sent).toEqual([]);
  });

  test("a quick tap on the title opens the ticket", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Tap") });
    await openBoard(page, team.id);
    const sent = writes(page);
    const link = card(page, ticket.title).getByRole("link");
    const b = await box(link);
    await page.touchscreen.tap(b.x + Math.min(20, b.width / 2), b.y + b.height / 2);
    await expect(page).toHaveURL(`/tickets/${ticket.id}`);
    expect(sent).toEqual([]);
  });

  test("a failed touch move rolls back and shows the error", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Touch fails") });
    await openBoard(page, team.id);
    await page.route("**/api/tickets/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, json: { statusCode: 500, message: "Internal server error" } })
        : route.fallback(),
    );

    await touchDragCardToColumn(page, card(page, ticket.title), column(page, "done"));
    await expect(page.getByTestId("move-error")).toContainText(
      `Couldn't move "${ticket.title}" to Done; it was returned to New. Internal server error`,
    );
    await expect(card(column(page, "new"), ticket.title)).toBeVisible();
    await expect(card(column(page, "done"), ticket.title)).toHaveCount(0);
    await page.unroute("**/api/tickets/*");
    await page.reload();
    await expect(card(column(page, "new"), ticket.title)).toBeVisible();
    expect(await apiState(page, cookie, ticket.id)).toBe("new");
  });
});
