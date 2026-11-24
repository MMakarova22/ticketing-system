import { type Page } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import {
  createEpic,
  createTeam,
  createTicket,
  deleteJson,
  getJson,
  patchJson,
  TICKET_STATE_VALUES,
  type TicketBody,
  type TicketStateValue,
  tick,
  uniqueName,
} from "../support/api.ts";
import {
  card,
  column,
  createTickets,
  dragCardToColumn,
  moveCardWithKeyboard,
  openBoard,
  sessionCookie,
  STATE_LABELS,
} from "../support/board.ts";
import { loginAsNewUser } from "../support/ui.ts";

/** Logs in through the UI and returns the session cookie for API set-up calls. */
async function setUp(page: Page): Promise<string> {
  await loginAsNewUser(page);
  return sessionCookie(page);
}

async function apiState(page: Page, cookie: string, id: string): Promise<TicketStateValue> {
  const response = await getJson(page.request, `/api/tickets/${id}`, cookie);
  expect(response.status()).toBe(200);
  return ((await response.json()) as TicketBody).state;
}

/** Waits for the PATCH of one ticket and returns its status. */
function patchResponse(page: Page, id: string) {
  return page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/tickets/${id}`));
}

const PATCH_TICKET = "**/api/tickets/*";

test.describe("Kanban board", () => {
  test("five columns in workflow order; tickets in their state's column; team switch uses history", async ({
    page,
  }) => {
    const cookie = await setUp(page);
    const teamA = await createTeam(page.request, cookie, uniqueName("Board A"));
    const teamB = await createTeam(page.request, cookie, uniqueName("Board B"));
    const titles = Object.fromEntries(TICKET_STATE_VALUES.map((s) => [s, uniqueName(`T-${s}`)])) as Record<
      TicketStateValue,
      string
    >;
    for (const state of TICKET_STATE_VALUES) {
      await createTicket(page.request, cookie, teamA.id, { state, title: titles[state] });
    }
    const otherTitle = uniqueName("Other team");
    await createTicket(page.request, cookie, teamB.id, { title: otherTitle });

    await openBoard(page, teamA.id);
    await expect(page.locator(".board-column-title")).toHaveText([
      "New",
      "Ready for implementation",
      "In progress",
      "Ready for acceptance",
      "Done",
    ]);
    for (const state of TICKET_STATE_VALUES) {
      const col = column(page, state);
      await expect(col.getByRole("heading", { level: 2 })).toContainText(STATE_LABELS[state]);
      await expect(card(col, titles[state])).toBeVisible();
      await expect(col.getByTestId("column-count")).toHaveText("1");
    }
    await expect(card(page, otherTitle)).toHaveCount(0);

    // Team change: new history entry, other team's tickets.
    await page.getByRole("combobox", { name: "Team" }).selectOption(teamB.id);
    await expect(page).toHaveURL(new RegExp(`teamId=${teamB.id}`));
    await expect(card(column(page, "new"), otherTitle)).toBeVisible();
    await expect(card(page, titles.new)).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`teamId=${teamA.id}`));
    await expect(card(column(page, "done"), titles.done)).toBeVisible();
    await page.goForward();
    await expect(card(column(page, "new"), otherTitle)).toBeVisible();
  });

  test("mouse drag persists, including Done → New, and lands at the top of the column", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const existing = await createTicket(page.request, cookie, team.id, { state: "in_progress", title: uniqueName("Existing") });
    await tick();
    const moving = await createTicket(page.request, cookie, team.id, { title: uniqueName("Moving") });
    const finished = await createTicket(page.request, cookie, team.id, { state: "done", title: uniqueName("Finished") });
    // Make "Existing" the most recently modified ticket, so "Moving" must be re-sorted above it.
    await tick();
    await patchJson(page.request, `/api/tickets/${existing.id}`, { body: "Touched" }, cookie);

    await openBoard(page, team.id);
    const patched = patchResponse(page, moving.id);
    await dragCardToColumn(page, card(column(page, "new"), moving.title), column(page, "in_progress"));
    expect((await patched).status()).toBe(200);
    const inProgress = column(page, "in_progress").getByTestId("ticket-card");
    await expect(inProgress.getByRole("link")).toHaveText([moving.title, existing.title]);
    await expect(column(page, "new").getByText("No tickets")).toBeVisible();

    const reopened = patchResponse(page, finished.id);
    await dragCardToColumn(page, card(column(page, "done"), finished.title), column(page, "new"));
    expect((await reopened).status()).toBe(200);
    await expect(card(column(page, "new"), finished.title)).toBeVisible();

    await page.reload();
    await expect(inProgress.getByRole("link")).toHaveText([moving.title, existing.title]);
    await expect(card(column(page, "new"), finished.title)).toBeVisible();
    await expect(column(page, "done").getByText("No tickets")).toBeVisible();
    expect(await apiState(page, cookie, moving.id)).toBe("in_progress");
    expect(await apiState(page, cookie, finished.id)).toBe("new");
  });

  test("keyboard drag persists; Escape cancels; Enter on the title opens the ticket", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Keyboard") });
    await openBoard(page, team.id);

    let patches = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH") patches += 1;
    });

    // Escape cancels: no request, card stays.
    await moveCardWithKeyboard(page, card(page, ticket.title), 2, column(page, "in_progress"), "Escape");
    await expect(card(column(page, "new"), ticket.title)).toBeVisible();
    expect(patches).toBe(0);

    // Right ×4: New → Done.
    let patched = patchResponse(page, ticket.id);
    await moveCardWithKeyboard(page, card(page, ticket.title), 4, column(page, "done"));
    expect((await patched).status()).toBe(200);
    await expect(card(column(page, "done"), ticket.title)).toBeVisible();

    // Left ×3: Done → Ready for implementation.
    patched = patchResponse(page, ticket.id);
    await moveCardWithKeyboard(page, card(page, ticket.title), -3, column(page, "ready_for_implementation"));
    expect((await patched).status()).toBe(200);

    await page.reload();
    await expect(card(column(page, "ready_for_implementation"), ticket.title)).toBeVisible();
    expect(await apiState(page, cookie, ticket.id)).toBe("ready_for_implementation");

    // The card is focusable and announces itself as draggable; its title link opens the ticket.
    const c = card(page, ticket.title);
    await expect(c).toHaveAttribute("aria-roledescription", "draggable ticket");
    await c.getByRole("link", { name: ticket.title }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
    await expect(page.getByRole("heading", { name: ticket.title })).toBeVisible();
  });

  test("clicking a card's title opens the ticket without moving it", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { state: "in_progress", title: uniqueName("Click") });
    await openBoard(page, team.id);
    await card(page, ticket.title).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
    await expect(page.getByTestId("ticket-state")).toHaveText("In progress");
  });

  test.describe("failed persistence restores the card", () => {
    test("HTTP 500: optimistic move, then rollback to the original column; reload confirms", async ({ page }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Fails") });
      await openBoard(page, team.id);

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(PATCH_TICKET, async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        await held;
        await route.fulfill({ status: 500, json: { statusCode: 500, message: "Internal server error" } });
      });

      await dragCardToColumn(page, card(page, ticket.title), column(page, "done"));
      // Optimistic: already in Done, marked as saving and not draggable.
      const optimistic = card(column(page, "done"), ticket.title);
      await expect(optimistic).toBeVisible();
      await expect(optimistic).toHaveAttribute("aria-busy", "true");
      await expect(optimistic).toHaveAttribute("aria-disabled", "true");

      release();
      await expect(card(column(page, "new"), ticket.title)).toBeVisible();
      await expect(card(column(page, "done"), ticket.title)).toHaveCount(0);
      await expect(page.getByTestId("move-error")).toContainText(
        `Couldn't move "${ticket.title}" to Done; it was returned to New. Internal server error`,
      );

      await page.unroute(PATCH_TICKET);
      await page.reload();
      await expect(card(column(page, "new"), ticket.title)).toBeVisible();
      expect(await apiState(page, cookie, ticket.id)).toBe("new");
    });

    test("network failure: rollback and a connection error", async ({ page }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id, { state: "done", title: uniqueName("Offline") });
      await openBoard(page, team.id);
      await page.route(PATCH_TICKET, (route) =>
        route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.fallback(),
      );

      await dragCardToColumn(page, card(page, ticket.title), column(page, "new"));
      await expect(page.getByTestId("move-error")).toContainText("Cannot reach the server");
      await expect(card(column(page, "done"), ticket.title)).toBeVisible();
      await expect(card(column(page, "new"), ticket.title)).toHaveCount(0);

      // The error can be dismissed, and a later move works.
      await page.getByRole("button", { name: "Dismiss" }).click();
      await expect(page.getByTestId("move-error")).toHaveCount(0);
      await page.unroute(PATCH_TICKET);
      const patched = patchResponse(page, ticket.id);
      await dragCardToColumn(page, card(page, ticket.title), column(page, "new"));
      expect((await patched).status()).toBe(200);
      expect(await apiState(page, cookie, ticket.id)).toBe("new");
    });

    test("a real server error (ticket deleted meanwhile, 404) rolls back, then the card disappears", async ({
      page,
    }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Deleted") });
      await openBoard(page, team.id);
      await expect(card(page, ticket.title)).toBeVisible();
      expect((await deleteJson(page.request, `/api/tickets/${ticket.id}`, cookie)).status()).toBe(204);

      const patched = patchResponse(page, ticket.id);
      await dragCardToColumn(page, card(page, ticket.title), column(page, "in_progress"));
      expect((await patched).status()).toBe(404);
      await expect(page.getByTestId("move-error")).toContainText(`"${ticket.title}" no longer exists`);
      await expect(card(page, ticket.title)).toHaveCount(0);
    });

    test("only the failed ticket is restored; a concurrent successful move is kept", async ({ page }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      const failing = await createTicket(page.request, cookie, team.id, { title: uniqueName("Failing") });
      const succeeding = await createTicket(page.request, cookie, team.id, { title: uniqueName("Succeeding") });
      await openBoard(page, team.id);

      let releaseFailure!: () => void;
      const failureHeld = new Promise<void>((resolve) => (releaseFailure = resolve));
      await page.route(`**/api/tickets/${failing.id}`, async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        await failureHeld;
        await route.fulfill({ status: 500, json: { statusCode: 500, message: "Boom" } });
      });

      await dragCardToColumn(page, card(page, failing.title), column(page, "done"));
      await expect(card(column(page, "done"), failing.title)).toBeVisible();
      const saved = patchResponse(page, succeeding.id);
      await dragCardToColumn(page, card(page, succeeding.title), column(page, "in_progress"));
      expect((await saved).status()).toBe(200);
      await expect(card(column(page, "in_progress"), succeeding.title)).toBeVisible();

      // Block list refetches, so what we see next comes from the rollback alone, not from a reload of the list.
      let releaseList!: () => void;
      const listHeld = new Promise<void>((resolve) => (releaseList = resolve));
      await page.route("**/api/tickets?teamId=*", async (route) => {
        await listHeld;
        await route.fallback();
      });

      releaseFailure();
      await expect(page.getByTestId("move-error")).toContainText(`Couldn't move "${failing.title}" to Done`);
      await expect(card(column(page, "new"), failing.title)).toBeVisible();
      await expect(card(column(page, "in_progress"), succeeding.title)).toBeVisible();
      await expect(card(column(page, "new"), succeeding.title)).toHaveCount(0);

      releaseList();
      await page.unrouteAll({ behavior: "wait" });
      await page.reload();
      await expect(card(column(page, "new"), failing.title)).toBeVisible();
      await expect(card(column(page, "in_progress"), succeeding.title)).toBeVisible();
    });

    test("dropping on the card's own column sends no request", async ({ page }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id, { state: "in_progress", title: uniqueName("Stay") });
      await openBoard(page, team.id);
      let patches = 0;
      page.on("request", (r) => {
        if (r.method() === "PATCH") patches += 1;
      });
      await dragCardToColumn(page, card(page, ticket.title), column(page, "in_progress"));
      await expect(card(column(page, "in_progress"), ticket.title)).toBeVisible();
      await page.waitForTimeout(300);
      expect(patches).toBe(0);
    });
  });

  test("filters: type, epic, No epic and case-insensitive search combine with AND and live in the URL", async ({
    page,
  }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const other = await createTeam(page.request, cookie);
    const payments = await createEpic(page.request, cookie, team.id, uniqueName("Payments"));
    const redesign = await createEpic(page.request, cookie, team.id, uniqueName("Redesign"));
    const t1 = await createTicket(page.request, cookie, team.id, { type: "bug", epicId: payments.id, title: "Checkout fails" });
    const t2 = await createTicket(page.request, cookie, team.id, {
      type: "feature",
      epicId: redesign.id,
      state: "in_progress",
      title: "Checkout redesign",
    });
    const t3 = await createTicket(page.request, cookie, team.id, { type: "bug", state: "done", title: "Login timeout" });
    const t4 = await createTicket(page.request, cookie, team.id, { type: "fix", title: "Fix checkout copy" });
    const all = [t1, t2, t3, t4].map((t) => t.title);

    const visible = page.getByTestId("ticket-card").getByRole("link");
    const typeFilter = page.getByRole("combobox", { name: "Type" });
    const epicFilter = page.getByRole("combobox", { name: "Epic" });
    const search = page.getByRole("searchbox", { name: "Search titles" });
    const summary = page.getByTestId("board-summary");
    async function expectVisible(titles: string[]) {
      await expect(visible).toHaveCount(titles.length);
      for (const title of titles) {
        await expect(card(page, title)).toBeVisible();
      }
    }

    // Start from another page so we can prove filter changes do not add history entries.
    await page.goto("/teams");
    await openBoard(page, team.id);
    await expectVisible(all);
    await expect(summary).toHaveText("4 tickets");
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();

    await typeFilter.selectOption("bug");
    await expectVisible([t1.title, t3.title]);
    await expect(summary).toHaveText("Showing 2 of 4 tickets");
    await expect(page).toHaveURL(/type=bug/);
    await expect(column(page, "new").getByTestId("column-count")).toHaveText("1 of 2");

    await epicFilter.selectOption({ label: "No epic" });
    await expectVisible([t3.title]);
    await expect(page).toHaveURL(/epic=none/);

    // Search is case-insensitive and ANDed: bug + no epic + "CHECKOUT" matches nothing.
    await search.fill("CHECKOUT");
    await expectVisible([]);
    await expect(page.getByText("No tickets match the filters.")).toBeVisible();
    await epicFilter.selectOption({ label: "All epics" });
    await expectVisible([t1.title]);
    await typeFilter.selectOption("");
    await expectVisible([t1.title, t2.title, t4.title]);
    await epicFilter.selectOption({ label: redesign.title });
    await expectVisible([t2.title]);
    await expect(page).toHaveURL(new RegExp(`epic=${redesign.id}`));
    await expect(page).toHaveURL(/q=CHECKOUT/);

    // Filters survive a reload.
    await page.reload();
    await expectVisible([t2.title]);
    await expect(epicFilter).toHaveValue(redesign.id);
    await expect(search).toHaveValue("CHECKOUT");

    // Clear resets everything.
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expectVisible(all);
    await expect(page).not.toHaveURL(/type=|epic=|q=/);
    await expect(page).toHaveURL(new RegExp(`teamId=${team.id}`));

    // Team change: a history entry; the team-specific epic filter is dropped, type and search are kept.
    await typeFilter.selectOption("bug");
    await epicFilter.selectOption({ label: payments.title });
    await search.fill("checkout");
    await expectVisible([t1.title]);
    await page.getByRole("combobox", { name: "Team" }).selectOption(other.id);
    await expect(page).toHaveURL(new RegExp(`teamId=${other.id}`));
    await expect(page).not.toHaveURL(/epic=/);
    await expect(page).toHaveURL(/type=bug/);
    await expect(search).toHaveValue("checkout");

    // Back returns to the first team with its filters; one more Back leaves the board (filters replaced entries).
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`teamId=${team.id}`));
    await expect(epicFilter).toHaveValue(payments.id);
    await expectVisible([t1.title]);
    await page.goBack();
    await expect(page).toHaveURL(/\/teams$/);
  });

  test("a stale epic filter in the URL is dropped", async ({ page }) => {
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Any") });
    const otherTeam = await createTeam(page.request, cookie);
    const foreignEpic = await createEpic(page.request, cookie, otherTeam.id);
    await openBoard(page, team.id, `&epic=${foreignEpic.id}`);
    await expect(page).not.toHaveURL(/epic=/);
    await expect(page.getByRole("combobox", { name: "Epic" })).toHaveValue("");
    await expect(card(page, ticket.title)).toBeVisible();
  });

  test("120 tickets: correct counts, drag still persists, search narrows", async ({ page }) => {
    test.setTimeout(120_000);
    const cookie = await setUp(page);
    const team = await createTeam(page.request, cookie);
    const fields = Array.from({ length: 120 }, (_, i) => ({
      state: TICKET_STATE_VALUES[i % 5],
      type: (["bug", "feature", "fix"] as const)[i % 3],
      title: `Load ticket ${String(i).padStart(3, "0")}`,
    }));
    await createTickets(page.request, cookie, team.id, fields);

    const started = Date.now();
    await openBoard(page, team.id);
    await expect(page.getByTestId("ticket-card")).toHaveCount(120);
    console.log(`board with 120 tickets rendered in ${Date.now() - started} ms`);
    await expect(page.getByTestId("board-summary")).toHaveText("120 tickets");
    for (const state of TICKET_STATE_VALUES) {
      await expect(column(page, state).getByTestId("column-count")).toHaveText("24");
    }

    // A card deep in a column (scrolled into view by the browser) can be dragged.
    const target = card(column(page, "new"), "Load ticket 100");
    await target.scrollIntoViewIfNeeded();
    const patched = patchResponse(page, (await target.getAttribute("data-ticket-id")) ?? "");
    const dragStarted = Date.now();
    await dragCardToColumn(page, target, column(page, "done"));
    expect((await patched).status()).toBe(200);
    await expect(card(column(page, "done"), "Load ticket 100")).toBeVisible();
    console.log(`drag of one of 120 cards persisted in ${Date.now() - dragStarted} ms`);
    await expect(column(page, "new").getByTestId("column-count")).toHaveText("23");
    await expect(column(page, "done").getByTestId("column-count")).toHaveText("25");

    await page.getByRole("searchbox", { name: "Search titles" }).fill("ticket 100");
    await expect(page.getByTestId("ticket-card")).toHaveCount(1);
    await expect(page.getByTestId("board-summary")).toHaveText("Showing 1 of 120 tickets");

    await page.reload();
    await expect(card(column(page, "done"), "Load ticket 100")).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(column(page, "done").getByTestId("column-count")).toHaveText("25");
  });

  test.describe("loading, empty and error states", () => {
    test("no teams", async ({ page }) => {
      await setUp(page);
      await page.route("**/api/teams", (route) =>
        route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.fallback(),
      );
      await page.goto("/");
      await expect(page.getByText("Tickets belong to a team, and there are no teams yet.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Teams" })).toBeVisible();
    });

    test("tickets fail to load, then Retry recovers", async ({ page }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      const ticket = await createTicket(page.request, cookie, team.id, { title: uniqueName("Retry") });
      await page.route("**/api/tickets?teamId=*", (route) =>
        route.fulfill({ status: 500, json: { statusCode: 500, message: "Internal server error" } }),
      );
      await page.goto(`/?teamId=${team.id}`);
      const alert = page.getByRole("alert").filter({ hasText: "Could not load tickets" });
      await expect(alert).toContainText("Internal server error");
      await expect(page.getByTestId("board")).toHaveCount(0);

      await page.unroute("**/api/tickets?teamId=*");
      await alert.getByRole("button", { name: "Retry" }).click();
      await expect(card(page, ticket.title)).toBeVisible();
    });

    test("loading state, then an empty team shows five empty columns", async ({ page }) => {
      const cookie = await setUp(page);
      const team = await createTeam(page.request, cookie);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/tickets?teamId=*", async (route) => {
        await held;
        await route.fallback();
      });
      await page.goto(`/?teamId=${team.id}`);
      await expect(page.getByText("Loading tickets…")).toBeVisible();
      release();
      await expect(page.getByText("No tickets for this team yet.")).toBeVisible();
      await expect(page.getByTestId("board").getByText("No tickets", { exact: true })).toHaveCount(5);
      await expect(page.getByRole("link", { name: "New ticket" })).toHaveAttribute("href", `/tickets/new?teamId=${team.id}`);
    });

    test("an unknown team id falls back to a listed team and rewrites the URL", async ({ page }) => {
      const cookie = await setUp(page);
      await createTeam(page.request, cookie); // at least one team exists, even on a fresh database
      await page.goto("/?teamId=00000000-0000-4000-8000-000000000000");
      await expect(page.getByTestId("board")).toBeVisible();
      await expect(page).not.toHaveURL(/00000000-0000-4000-8000-000000000000/);
      await expect(page).toHaveURL(/teamId=[0-9a-f-]{36}/);
    });
  });
});
