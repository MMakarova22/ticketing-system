import { type APIRequestContext, expect, type Locator, type Page } from "@playwright/test";
import { createTicket, type TicketBody, type TicketStateValue } from "./api.ts";
import { SESSION_COOKIE } from "./auth.ts";

export const STATE_LABELS: Record<TicketStateValue, string> = {
  new: "New",
  ready_for_implementation: "Ready for implementation",
  in_progress: "In progress",
  ready_for_acceptance: "Ready for acceptance",
  done: "Done",
};

/**
 * The browser's session cookie as "name=value", for API calls made next to a logged-in page.
 * (Sent explicitly: the API request context does not send the Secure cookie over plain http.)
 */
export async function sessionCookie(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
  if (!cookie) {
    throw new Error("The page has no session cookie; log in first");
  }
  return `${cookie.name}=${cookie.value}`;
}

/** Creates many tickets through the API, a batch at a time. */
export async function createTickets(
  request: APIRequestContext,
  cookie: string,
  teamId: string,
  fields: Record<string, unknown>[],
  batchSize = 20,
): Promise<TicketBody[]> {
  const created: TicketBody[] = [];
  for (let i = 0; i < fields.length; i += batchSize) {
    const batch = fields.slice(i, i + batchSize).map((f) => createTicket(request, cookie, teamId, f));
    created.push(...(await Promise.all(batch)));
  }
  return created;
}

export function column(page: Page, state: TicketStateValue): Locator {
  return page.getByTestId(`column-${state}`);
}

export function card(scope: Page | Locator, title: string): Locator {
  const page = "goto" in scope ? scope : scope.page();
  return scope.getByTestId("ticket-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

/** Opens the board for a team and waits until its tickets are shown. */
export async function openBoard(page: Page, teamId: string, query = ""): Promise<void> {
  await page.goto(`/?teamId=${teamId}${query}`);
  await expect(page.getByTestId("board")).toBeVisible();
}

/** Mouse drag: press on the card, move past the 5 px activation distance, move over the column, release. */
export async function dragCardToColumn(page: Page, source: Locator, target: Locator): Promise<void> {
  // A card cannot be dragged while its previous move is still being saved.
  await expect(source).not.toHaveAttribute("aria-busy", "true");
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) {
    throw new Error("Card or column is not visible");
  }
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height - 6;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 4, { steps: 3 });
  await expect(page.locator(".card-overlay")).toBeVisible();
  const endX = to.x + to.width / 2;
  const endY = to.y + Math.min(120, to.height / 2);
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.move(endX + 2, endY + 2, { steps: 2 });
  await page.mouse.up();
  await expect(page.locator(".card-overlay")).toHaveCount(0);
}

/**
 * Keyboard drag: focus the card, Space to pick it up, Left/Right arrows to change column, Space to drop
 * (or Escape to cancel). Waits for the target column to be highlighted before dropping.
 */
export async function moveCardWithKeyboard(
  page: Page,
  source: Locator,
  steps: number,
  target: Locator,
  finish: "Space" | "Escape" = "Space",
): Promise<void> {
  await expect(source).not.toHaveAttribute("aria-busy", "true");
  await source.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".card-overlay")).toBeVisible();
  // dnd-kit's KeyboardSensor attaches its keydown listener in a setTimeout after pick-up, and Chrome can deliver
  // synthetic input before that timer runs. Flushing one page task first makes the arrow presses deterministic
  // (a person cannot press keys fast enough to hit this window).
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await page.keyboard.press(steps > 0 ? "ArrowRight" : "ArrowLeft");
  }
  await expect(target).toHaveClass(/board-column-over/);
  await page.keyboard.press(finish);
  await expect(page.locator(".card-overlay")).toHaveCount(0);
}

// --- Touch input -----------------------------------------------------------------------------------------------------
// Playwright has no touch-move API, so touches go through the Chromium DevTools protocol (Input.dispatchTouchEvent),
// which drives the real input pipeline: touch and pointer events, native scrolling and gestures. Chromium only, in a
// context with `hasTouch: true`.

export interface Point {
  x: number;
  y: number;
}

export interface Finger {
  down(point: Point): Promise<void>;
  move(point: Point): Promise<void>;
  up(): Promise<void>;
}

export async function finger(page: Page): Promise<Finger> {
  const cdp = await page.context().newCDPSession(page);
  const send = async (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: Point[]) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  };
  return { down: (p) => send("touchStart", [p]), move: (p) => send("touchMove", [p]), up: () => send("touchEnd", []) };
}

/** A point on the card itself, near its bottom edge (not on the title link), like the mouse helper uses. */
export async function gripPoint(source: Locator): Promise<Point> {
  const box = await source.boundingBox();
  if (!box) {
    throw new Error("Card is not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height - 6 };
}

/** Records whether the drag overlay appears at any time from now on (also between two assertions). */
export async function watchOverlay(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const w = window as unknown as { __overlaySeen: boolean };
    w.__overlaySeen = false;
    new MutationObserver(() => {
      if (document.querySelector(".card-overlay")) {
        w.__overlaySeen = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { __overlaySeen: boolean }).__overlaySeen);
}

/** Quick swipe: the finger starts moving right away (no hold), `steps` moves of (dx, dy) each, then lifts. */
export async function touchSwipe(page: Page, from: Point, dx: number, dy: number, steps = 10): Promise<void> {
  const f = await finger(page);
  await f.down(from);
  for (let i = 1; i <= steps; i += 1) {
    await f.move({ x: from.x + dx * i, y: from.y + dy * i });
  }
  await f.up();
}

/**
 * Asserts that the drag overlay's box contains the point (the finger or the mouse pointer). Polls, because the overlay
 * follows the input on the next render.
 */
export async function expectOverlayUnder(page: Page, point: Point): Promise<void> {
  await expect
    .poll(async () => {
      const box = await page.locator(".card-overlay").boundingBox();
      const inside =
        box !== null &&
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height;
      return inside ? "under the pointer" : `overlay ${JSON.stringify(box)}, pointer ${JSON.stringify(point)}`;
    })
    .toBe("under the pointer");
}

/**
 * Touch drag: press and hold the card for `holdMs` (default 300 ms, past the 200 ms activation delay), check that it
 * was picked up, move over the target column checking that the overlay stays under the finger, and lift the finger.
 */
export async function touchDragCardToColumn(page: Page, source: Locator, target: Locator, holdMs = 300): Promise<void> {
  await expect(source).not.toHaveAttribute("aria-busy", "true");
  const start = await gripPoint(source);
  const to = await target.boundingBox();
  if (!to) {
    throw new Error("Column is not visible");
  }
  const end = { x: to.x + to.width / 2, y: to.y + Math.min(120, to.height / 2) };
  const f = await finger(page);
  await f.down(start);
  await page.waitForTimeout(holdMs);
  await expect(page.locator(".card-overlay")).toBeVisible();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    const point = { x: start.x + ((end.x - start.x) * i) / steps, y: start.y + ((end.y - start.y) * i) / steps };
    await f.move(point);
    if (i % 4 === 0) {
      await expectOverlayUnder(page, point);
    }
  }
  await expect(target).toHaveClass(/board-column-over/);
  await f.up();
  await expect(page.locator(".card-overlay")).toHaveCount(0);
}
