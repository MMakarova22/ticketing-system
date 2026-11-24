import { type APIRequestContext } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import {
  createTeam,
  createTicket,
  getJson,
  MISSING_ID,
  patchJson,
  TICKET_STATE_VALUES,
  type TicketBody,
  tick,
} from "../support/api.ts";
import { createLoggedInUser } from "../support/auth.ts";

test.use({ storageState: { cookies: [], origins: [] } });

async function getTicket(request: APIRequestContext, cookie: string, id: string): Promise<TicketBody> {
  const response = await getJson(request, `/api/tickets/${id}`, cookie);
  expect(response.status()).toBe(200);
  return (await response.json()) as TicketBody;
}

async function listTickets(request: APIRequestContext, cookie: string, teamId: string): Promise<TicketBody[]> {
  const response = await getJson(request, `/api/tickets?teamId=${teamId}`, cookie);
  expect(response.status()).toBe(200);
  return (await response.json()) as TicketBody[];
}

/** Board persistence: drag-and-drop is `PATCH /api/tickets/:id {state}` (spec §8, M4). */
test.describe("board moves (PATCH state)", () => {
  test("all 20 state transitions are allowed and persist, including Done → New", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);

    let count = 0;
    for (const from of TICKET_STATE_VALUES) {
      for (const to of TICKET_STATE_VALUES) {
        if (from === to) {
          continue;
        }
        const label = `${from} → ${to}`;
        const ticket = await createTicket(request, cookie, team.id, { state: from });
        expect(ticket.state, label).toBe(from);
        await tick();

        const response = await patchJson(request, `/api/tickets/${ticket.id}`, { state: to }, cookie);
        expect(response.status(), label).toBe(200);
        const moved = (await response.json()) as TicketBody;
        expect(moved.state, label).toBe(to);
        expect(Date.parse(moved.modifiedAt), label).toBeGreaterThan(Date.parse(ticket.modifiedAt));
        expect({ ...moved, state: from, modifiedAt: ticket.modifiedAt }, label).toEqual(ticket);

        // What the board shows after a reload: the ticket in its new state, first in the list.
        expect((await getTicket(request, cookie, ticket.id)).state, label).toBe(to);
        const [first] = await listTickets(request, cookie, team.id);
        expect(first?.id, label).toBe(ticket.id);
        expect(first?.state, label).toBe(to);
        count += 1;
      }
    }
    expect(count).toBe(20);
  });

  test("dropping on the current column is a no-op: modifiedAt and the order stay (D7)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const older = await createTicket(request, cookie, team.id, { state: "in_progress" });
    await tick();
    const newer = await createTicket(request, cookie, team.id, { state: "in_progress" });
    await tick();

    const response = await patchJson(request, `/api/tickets/${older.id}`, { state: "in_progress" }, cookie);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(older);
    expect((await listTickets(request, cookie, team.id)).map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  test("a rejected move leaves the ticket unchanged", async ({ request, playwright }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id, { state: "ready_for_acceptance" });
    const path = `/api/tickets/${ticket.id}`;

    for (const state of ["closed", "DONE", "", null, 42, ["done"]]) {
      const response = await patchJson(request, path, { state }, cookie);
      expect(response.status(), JSON.stringify(state)).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_ERROR");
    }
    // No session (a fresh request context: this one's cookie jar holds the login cookie).
    const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL ?? "http://localhost:3000" });
    expect((await patchJson(anonymous, path, { state: "done" })).status()).toBe(401);
    await anonymous.dispose();
    // Not JSON (CSRF rule).
    const form = { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" };
    expect((await request.patch(path, { headers: form, data: "state=done" })).status()).toBe(415);
    // Unknown ticket.
    const missing = await patchJson(request, `/api/tickets/${MISSING_ID}`, { state: "done" }, cookie);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).code).toBe("TICKET_NOT_FOUND");

    expect(await getTicket(request, cookie, ticket.id)).toEqual(ticket);
  });

  test("the list returns every ticket of a 120-ticket board, newest modification first", async ({ request }) => {
    test.setTimeout(60_000);
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    for (let i = 0; i < 120; i += 20) {
      await Promise.all(
        Array.from({ length: 20 }, (_, j) =>
          createTicket(request, cookie, team.id, { state: TICKET_STATE_VALUES[(i + j) % 5], title: `Load ${i + j}` }),
        ),
      );
    }

    const list = await listTickets(request, cookie, team.id);
    expect(list).toHaveLength(120);
    for (const state of TICKET_STATE_VALUES) {
      expect(list.filter((t) => t.state === state), state).toHaveLength(24);
    }
    const times = list.map((t) => Date.parse(t.modifiedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
