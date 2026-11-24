import { expect, test } from "../support/test.ts";
import {
  addComment,
  createEpic,
  createTeam,
  createTicket,
  deleteJson,
  type EpicBody,
  getJson,
  ISO_UTC,
  MISSING_ID,
  patchJson,
  type TeamBody,
  TICKET_STATE_VALUES,
  type TicketBody,
  tick,
  uniqueName,
} from "../support/api.ts";
import { createLoggedInUser, postJson } from "../support/auth.ts";

test.use({ storageState: { cookies: [], origins: [] } });

async function getTicket(request: Parameters<typeof getJson>[0], cookie: string, id: string): Promise<TicketBody> {
  const response = await getJson(request, `/api/tickets/${id}`, cookie);
  expect(response.status()).toBe(200);
  return (await response.json()) as TicketBody;
}

async function getTeam(request: Parameters<typeof getJson>[0], cookie: string, id: string): Promise<TeamBody> {
  const teams = (await (await getJson(request, "/api/teams", cookie)).json()) as TeamBody[];
  const team = teams.find((t) => t.id === id);
  expect(team).toBeDefined();
  return team as TeamBody;
}

async function getEpic(request: Parameters<typeof getJson>[0], cookie: string, id: string): Promise<EpicBody> {
  return (await (await getJson(request, `/api/epics/${id}`, cookie)).json()) as EpicBody;
}

test.describe("tickets API", () => {
  test("every route requires a session", async ({ request }) => {
    expect((await request.get(`/api/tickets?teamId=${MISSING_ID}`)).status()).toBe(401);
    expect((await request.get(`/api/tickets/${MISSING_ID}`)).status()).toBe(401);
    expect((await postJson(request, "/api/tickets", { teamId: MISSING_ID })).status()).toBe(401);
    expect((await patchJson(request, `/api/tickets/${MISSING_ID}`, { state: "done" })).status()).toBe(401);
    expect((await deleteJson(request, `/api/tickets/${MISSING_ID}`)).status()).toBe(401);
  });

  test("writes without a JSON content type are rejected (415)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);
    const form = { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" };
    expect((await request.post("/api/tickets", { headers: form, data: "title=x" })).status()).toBe(415);
    expect((await request.patch(`/api/tickets/${ticket.id}`, { headers: form, data: "state=done" })).status()).toBe(415);
    expect((await request.delete(`/api/tickets/${ticket.id}`, { headers: { Cookie: cookie } })).status()).toBe(415);
    expect((await getJson(request, `/api/tickets/${ticket.id}`, cookie)).status()).toBe(200);
  });

  test("create: trims, defaults to state new, sets the creator from the session", async ({ request }) => {
    const { cookie, email } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);

    const ticket = await createTicket(request, cookie, team.id, {
      epicId: epic.id,
      type: "bug",
      title: "  Checkout fails  ",
      body: "\n  Steps to reproduce.\n  ",
    });
    expect(ticket).toMatchObject({
      teamId: team.id,
      epicId: epic.id,
      epic: { id: epic.id, title: epic.title },
      type: "bug",
      state: "new",
      title: "Checkout fails",
      body: "Steps to reproduce.",
      createdBy: { email },
      commentCount: 0,
    });
    expect(ticket.createdAt).toMatch(ISO_UTC);
    expect(ticket.modifiedAt).toBe(ticket.createdAt);
    expect(await getTicket(request, cookie, ticket.id)).toEqual(ticket);

    const noEpic = await createTicket(request, cookie, team.id, { epicId: null, type: "fix", state: "in_progress" });
    expect(noEpic).toMatchObject({ epicId: null, epic: null, type: "fix", state: "in_progress" });
  });

  test("create validation (400) and unknown team (404)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const base = { teamId: team.id, type: "bug", title: "Title", body: "Body" };
    const invalid: Record<string, unknown>[] = [
      { ...base, title: undefined },
      { ...base, title: "   " },
      { ...base, body: undefined },
      { ...base, body: "" },
      { ...base, body: " \n\t " },
      { ...base, body: 5 },
      { ...base, type: undefined },
      { ...base, type: "story" },
      { ...base, state: "closed" },
      { ...base, state: null },
      { ...base, teamId: undefined },
      { ...base, teamId: "not-a-uuid" },
      { ...base, epicId: "not-a-uuid" },
      { ...base, createdById: MISSING_ID },
      { ...base, createdAt: "2020-01-01T00:00:00.000Z" },
      { ...base, modifiedAt: "2020-01-01T00:00:00.000Z" },
      { ...base, id: MISSING_ID },
    ];
    for (const data of invalid) {
      const response = await postJson(request, "/api/tickets", data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    }

    const missingTeam = await postJson(request, "/api/tickets", { ...base, teamId: MISSING_ID }, cookie);
    expect(missingTeam.status()).toBe(404);
    expect(await missingTeam.json()).toMatchObject({ statusCode: 404, code: "TEAM_NOT_FOUND" });

    const list = (await (await getJson(request, `/api/tickets?teamId=${team.id}`, cookie)).json()) as TicketBody[];
    expect(list).toEqual([]);
  });

  test("create: the epic must exist and belong to the same team (400 INVALID_EPIC)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const other = await createTeam(request, cookie);
    const otherEpic = await createEpic(request, cookie, other.id);
    const base = { teamId: team.id, type: "bug", title: "Title", body: "Body" };

    for (const epicId of [otherEpic.id, MISSING_ID]) {
      const response = await postJson(request, "/api/tickets", { ...base, epicId }, cookie);
      expect(response.status(), epicId).toBe(400);
      expect(await response.json()).toMatchObject({ statusCode: 400, code: "INVALID_EPIC" });
    }
    expect((await getEpic(request, cookie, otherEpic.id)).ticketCount).toBe(0);
  });

  test("get: unknown id 404, malformed id 400", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const missing = await getJson(request, `/api/tickets/${MISSING_ID}`, cookie);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "TICKET_NOT_FOUND" });
    const malformed = await getJson(request, "/api/tickets/xyz", cookie);
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("list: only the team's tickets, newest modification first", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const other = await createTeam(request, cookie);
    const first = await createTicket(request, cookie, team.id);
    await tick();
    const second = await createTicket(request, cookie, team.id);
    await createTicket(request, cookie, other.id);

    const ids = async () =>
      ((await (await getJson(request, `/api/tickets?teamId=${team.id}`, cookie)).json()) as TicketBody[]).map(
        (t) => t.id,
      );
    expect(await ids()).toEqual([second.id, first.id]);

    await tick();
    expect((await patchJson(request, `/api/tickets/${first.id}`, { state: "done" }, cookie)).status()).toBe(200);
    expect(await ids()).toEqual([first.id, second.id]);
  });

  test("list requires a valid teamId (400) of an existing team (404)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    for (const path of ["/api/tickets", "/api/tickets?teamId=", "/api/tickets?teamId=abc"]) {
      const response = await getJson(request, path, cookie);
      expect(response.status(), path).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    const missing = await getJson(request, `/api/tickets?teamId=${MISSING_ID}`, cookie);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "TEAM_NOT_FOUND" });
  });

  test("update: every editable field, trimmed; modifiedAt advances", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id);
    await tick();

    const response = await patchJson(
      request,
      `/api/tickets/${ticket.id}`,
      { epicId: epic.id, type: "fix", state: "in_progress", title: " New title ", body: " New body " },
      cookie,
    );
    expect(response.status()).toBe(200);
    const updated = (await response.json()) as TicketBody;
    expect(updated).toMatchObject({
      id: ticket.id,
      teamId: team.id,
      epicId: epic.id,
      epic: { id: epic.id, title: epic.title },
      type: "fix",
      state: "in_progress",
      title: "New title",
      body: "New body",
      createdAt: ticket.createdAt,
      createdBy: ticket.createdBy,
    });
    expect(Date.parse(updated.modifiedAt)).toBeGreaterThan(Date.parse(ticket.modifiedAt));

    await tick();
    const cleared = (await (await patchJson(request, `/api/tickets/${ticket.id}`, { epicId: null }, cookie)).json()) as TicketBody;
    expect(cleared).toMatchObject({ epicId: null, epic: null });
    expect(Date.parse(cleared.modifiedAt)).toBeGreaterThan(Date.parse(updated.modifiedAt));
  });

  test("any state can move to any state, including back from done", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);

    const path = ["done", "new", "ready_for_acceptance", "ready_for_implementation", "done", "in_progress", "new"];
    for (const state of path) {
      const response = await patchJson(request, `/api/tickets/${ticket.id}`, { state }, cookie);
      expect(response.status(), state).toBe(200);
      expect((await response.json()).state).toBe(state);
    }
    for (const state of TICKET_STATE_VALUES) {
      expect((await patchJson(request, `/api/tickets/${ticket.id}`, { state }, cookie)).status()).toBe(200);
    }
  });

  test("no-op updates keep modifiedAt (D7)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id, {
      epicId: epic.id,
      type: "bug",
      state: "in_progress",
      title: "Same title",
      body: "Same body",
    });
    await tick();

    const noOps: Record<string, unknown>[] = [
      {},
      { state: "in_progress" },
      { type: "bug" },
      { title: "Same title" },
      { title: "  Same title  ", body: "\nSame body\n" },
      { teamId: team.id, epicId: epic.id },
      { teamId: team.id, epicId: epic.id, type: "bug", state: "in_progress", title: "Same title", body: "Same body" },
    ];
    for (const data of noOps) {
      const response = await patchJson(request, `/api/tickets/${ticket.id}`, data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(200);
      expect(await response.json(), JSON.stringify(data)).toEqual(ticket);
    }

    const noEpic = await createTicket(request, cookie, team.id);
    await tick();
    const same = await patchJson(request, `/api/tickets/${noEpic.id}`, { epicId: null }, cookie);
    expect(await same.json()).toEqual(noEpic);
  });

  test("adding a comment does not change the ticket's modifiedAt", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);
    await tick();
    await addComment(request, cookie, ticket.id, "First");
    await tick();
    await addComment(request, cookie, ticket.id, "Second");

    const after = await getTicket(request, cookie, ticket.id);
    expect(after.modifiedAt).toBe(ticket.modifiedAt);
    expect(after.commentCount).toBe(2);
  });

  test("team change: the epic must belong to the new team", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const teamA = await createTeam(request, cookie);
    const teamB = await createTeam(request, cookie);
    const epicA = await createEpic(request, cookie, teamA.id);
    const epicB = await createEpic(request, cookie, teamB.id);
    const ticket = await createTicket(request, cookie, teamA.id, { epicId: epicA.id });

    // Keeping the old team's epic, implicitly or explicitly, is rejected and changes nothing.
    for (const data of [{ teamId: teamB.id }, { teamId: teamB.id, epicId: epicA.id }]) {
      const response = await patchJson(request, `/api/tickets/${ticket.id}`, data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_EPIC" });
    }
    // An epic of another team without a team change is rejected too.
    const wrongEpic = await patchJson(request, `/api/tickets/${ticket.id}`, { epicId: epicB.id }, cookie);
    expect(wrongEpic.status()).toBe(400);
    expect(await wrongEpic.json()).toMatchObject({ code: "INVALID_EPIC" });
    const missingEpic = await patchJson(request, `/api/tickets/${ticket.id}`, { epicId: MISSING_ID }, cookie);
    expect(missingEpic.status()).toBe(400);
    expect(await missingEpic.json()).toMatchObject({ code: "INVALID_EPIC" });
    expect(await getTicket(request, cookie, ticket.id)).toEqual(ticket);

    // Moving with the new team's epic, or with no epic, works.
    const moved = await patchJson(request, `/api/tickets/${ticket.id}`, { teamId: teamB.id, epicId: epicB.id }, cookie);
    expect(moved.status()).toBe(200);
    expect(await moved.json()).toMatchObject({ teamId: teamB.id, epicId: epicB.id, epic: { title: epicB.title } });

    const back = await patchJson(request, `/api/tickets/${ticket.id}`, { teamId: teamA.id, epicId: null }, cookie);
    expect(back.status()).toBe(200);
    expect(await back.json()).toMatchObject({ teamId: teamA.id, epicId: null, epic: null });

    // A ticket without an epic can change team on its own.
    const alone = await patchJson(request, `/api/tickets/${ticket.id}`, { teamId: teamB.id }, cookie);
    expect(alone.status()).toBe(200);
    expect(await alone.json()).toMatchObject({ teamId: teamB.id, epicId: null });
  });

  test("update validation (400), unknown team (404), unknown ticket (404)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);

    const invalid: Record<string, unknown>[] = [
      { title: "  " },
      { title: null },
      { body: " " },
      { body: null },
      { type: "story" },
      { type: null },
      { state: "closed" },
      { state: null },
      { teamId: null },
      { teamId: "abc" },
      { epicId: "abc" },
      { createdById: MISSING_ID },
      { createdAt: "2020-01-01T00:00:00.000Z" },
      { modifiedAt: "2020-01-01T00:00:00.000Z" },
    ];
    for (const data of invalid) {
      const response = await patchJson(request, `/api/tickets/${ticket.id}`, data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await getTicket(request, cookie, ticket.id)).toEqual(ticket);

    const missingTeam = await patchJson(request, `/api/tickets/${ticket.id}`, { teamId: MISSING_ID }, cookie);
    expect(missingTeam.status()).toBe(404);
    expect(await missingTeam.json()).toMatchObject({ code: "TEAM_NOT_FOUND" });

    const missing = await patchJson(request, `/api/tickets/${MISSING_ID}`, { state: "done" }, cookie);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "TICKET_NOT_FOUND" });
    expect((await patchJson(request, "/api/tickets/xyz", { state: "done" }, cookie)).status()).toBe(400);
  });

  test("ticket writes do not change the team's or epic's modifiedAt", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    await tick();
    const ticket = await createTicket(request, cookie, team.id, { epicId: epic.id });
    await patchJson(request, `/api/tickets/${ticket.id}`, { state: "done" }, cookie);

    expect((await getTeam(request, cookie, team.id)).modifiedAt).toBe(team.modifiedAt);
    expect((await getEpic(request, cookie, epic.id)).modifiedAt).toBe(epic.modifiedAt);
  });

  test("delete removes the ticket and its comments and updates the team and epic counts", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id, { epicId: epic.id });
    const kept = await createTicket(request, cookie, team.id, { epicId: epic.id });
    await addComment(request, cookie, ticket.id, "One");
    await addComment(request, cookie, ticket.id, "Two");
    const keptComment = await addComment(request, cookie, kept.id, "Keep me");

    expect((await getTeam(request, cookie, team.id)).ticketCount).toBe(2);
    expect((await getEpic(request, cookie, epic.id)).ticketCount).toBe(2);

    expect((await deleteJson(request, `/api/tickets/${ticket.id}`, cookie)).status()).toBe(204);

    const gone = await getJson(request, `/api/tickets/${ticket.id}`, cookie);
    expect(gone.status()).toBe(404);
    expect(await gone.json()).toMatchObject({ code: "TICKET_NOT_FOUND" });
    const goneComments = await getJson(request, `/api/tickets/${ticket.id}/comments`, cookie);
    expect(goneComments.status()).toBe(404);
    expect(await goneComments.json()).toMatchObject({ code: "TICKET_NOT_FOUND" });

    expect((await getTeam(request, cookie, team.id)).ticketCount).toBe(1);
    expect((await getEpic(request, cookie, epic.id)).ticketCount).toBe(1);
    // Other tickets' comments are untouched.
    expect(await (await getJson(request, `/api/tickets/${kept.id}/comments`, cookie)).json()).toEqual([keptComment]);

    const again = await deleteJson(request, `/api/tickets/${ticket.id}`, cookie);
    expect(again.status()).toBe(404);
    expect(await again.json()).toMatchObject({ code: "TICKET_NOT_FOUND" });
    expect((await deleteJson(request, "/api/tickets/nope", cookie)).status()).toBe(400);
  });

  test("a team or epic referenced by a ticket cannot be deleted (409)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie, uniqueName("Busy team"));
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id, { epicId: epic.id });

    const epicBlocked = await deleteJson(request, `/api/epics/${epic.id}`, cookie);
    expect(epicBlocked.status()).toBe(409);
    const epicBody = await epicBlocked.json();
    expect(epicBody).toMatchObject({ statusCode: 409, code: "EPIC_IN_USE" });
    expect(epicBody.message).toContain("1 ticket");

    // Without its epic, the ticket still blocks the team.
    await patchJson(request, `/api/tickets/${ticket.id}`, { epicId: null }, cookie);
    expect((await deleteJson(request, `/api/epics/${epic.id}`, cookie)).status()).toBe(204);
    const teamBlocked = await deleteJson(request, `/api/teams/${team.id}`, cookie);
    expect(teamBlocked.status()).toBe(409);
    const teamBody = await teamBlocked.json();
    expect(teamBody).toMatchObject({ statusCode: 409, code: "TEAM_IN_USE" });
    expect(teamBody.message).toContain("1 ticket");
    expect((await getTeam(request, cookie, team.id)).ticketCount).toBe(1);

    expect((await deleteJson(request, `/api/tickets/${ticket.id}`, cookie)).status()).toBe(204);
    expect((await deleteJson(request, `/api/teams/${team.id}`, cookie)).status()).toBe(204);
  });
});
