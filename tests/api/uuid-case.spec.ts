import { expect, test } from "../support/test.ts";
import {
  addComment,
  createEpic,
  createTeam,
  createTicket,
  deleteJson,
  type EpicBody,
  getJson,
  patchJson,
  type TicketBody,
  tick,
} from "../support/api.ts";
import { createLoggedInUser, postJson } from "../support/auth.ts";

// Review L1: UUIDs are accepted in any letter case and normalized to lower case, which is how PostgreSQL stores and
// returns them. Before the fix, an upper-case copy of an existing id made the API reject valid epic/team pairs
// (400 INVALID_EPIC) and advance modifiedAt on updates that changed nothing (D7).

test.use({ storageState: { cookies: [], origins: [] } });

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Upper-cases every letter, or (mixed) alternates the case of the hex letters. */
function recase(id: string, mode: "upper" | "mixed" = "upper"): string {
  if (mode === "upper") {
    return id.toUpperCase();
  }
  let flip = false;
  return id.replace(/[a-f]/g, (c) => ((flip = !flip) ? c.toUpperCase() : c));
}

test.describe("UUID letter case (review L1)", () => {
  test("PATCH with the current team id upper-cased: no INVALID_EPIC and modifiedAt unchanged", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id, { epicId: epic.id });
    await tick();

    const response = await patchJson(request, `/api/tickets/${ticket.id}`, { teamId: recase(team.id) }, cookie);
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as TicketBody;
    expect(body.teamId).toBe(team.id);
    expect(body.epicId).toBe(epic.id);
    expect(body.modifiedAt).toBe(ticket.modifiedAt);
  });

  test("PATCH with the current ids upper-cased (no epic, then with epic) keeps modifiedAt (D7)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const withoutEpic = await createTicket(request, cookie, team.id);
    const withEpic = await createTicket(request, cookie, team.id, { epicId: epic.id });
    await tick();

    const noEpic = await patchJson(request, `/api/tickets/${withoutEpic.id}`, { teamId: recase(team.id, "mixed") }, cookie);
    expect(noEpic.status(), await noEpic.text()).toBe(200);
    expect(((await noEpic.json()) as TicketBody).modifiedAt).toBe(withoutEpic.modifiedAt);

    const sameEpic = await patchJson(
      request,
      `/api/tickets/${withEpic.id}`,
      { teamId: recase(team.id), epicId: recase(epic.id) },
      cookie,
    );
    expect(sameEpic.status(), await sameEpic.text()).toBe(200);
    const body = (await sameEpic.json()) as TicketBody;
    expect(body.epicId).toBe(epic.id);
    expect(body.modifiedAt).toBe(withEpic.modifiedAt);
  });

  test("a real change sent with upper-case ids is applied and stored lower-case", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const teamA = await createTeam(request, cookie);
    const teamB = await createTeam(request, cookie);
    const epicB = await createEpic(request, cookie, teamB.id);
    const ticket = await createTicket(request, cookie, teamA.id);
    await tick();

    const moved = await patchJson(
      request,
      `/api/tickets/${recase(ticket.id)}`,
      { teamId: recase(teamB.id), epicId: recase(epicB.id) },
      cookie,
    );
    expect(moved.status(), await moved.text()).toBe(200);
    const body = (await moved.json()) as TicketBody;
    expect(body).toMatchObject({ id: ticket.id, teamId: teamB.id, epicId: epicB.id });
    expect(body.modifiedAt > ticket.modifiedAt).toBe(true);

    // An epic of another team is still rejected, whatever the case.
    const epicA = await createEpic(request, cookie, teamA.id);
    const mismatch = await patchJson(request, `/api/tickets/${ticket.id}`, { epicId: recase(epicA.id) }, cookie);
    expect(mismatch.status()).toBe(400);
    expect(await mismatch.json()).toMatchObject({ code: "INVALID_EPIC" });
  });

  test("POST ticket and epic with upper-case ids: 201 and lower-case ids in the response", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);

    const epicResponse = await postJson(request, "/api/epics", { teamId: recase(team.id), title: "Upper-case team id" }, cookie);
    expect(epicResponse.status(), await epicResponse.text()).toBe(201);
    const epic = (await epicResponse.json()) as EpicBody;
    expect(epic.teamId).toBe(team.id);

    const ticketResponse = await postJson(
      request,
      "/api/tickets",
      { teamId: recase(team.id), epicId: recase(epic.id, "mixed"), type: "bug", title: "Upper-case ids", body: "Body" },
      cookie,
    );
    expect(ticketResponse.status(), await ticketResponse.text()).toBe(201);
    const ticket = (await ticketResponse.json()) as TicketBody;
    expect(ticket.teamId).toBe(team.id);
    expect(ticket.epicId).toBe(epic.id);
    expect(ticket.id).toMatch(LOWER_UUID);
  });

  test("route and query ids are accepted in any case", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);
    const ticket = await createTicket(request, cookie, team.id, { epicId: epic.id });
    await addComment(request, cookie, recase(ticket.id), "Comment via upper-case ticket id");

    const get = await getJson(request, `/api/tickets/${recase(ticket.id)}`, cookie);
    expect(get.status()).toBe(200);
    expect(((await get.json()) as TicketBody).id).toBe(ticket.id);

    const list = await getJson(request, `/api/tickets?teamId=${recase(team.id, "mixed")}`, cookie);
    expect(list.status()).toBe(200);
    expect(((await list.json()) as TicketBody[]).map((t) => t.id)).toEqual([ticket.id]);

    const comments = await getJson(request, `/api/tickets/${recase(ticket.id, "mixed")}/comments`, cookie);
    expect(comments.status()).toBe(200);
    const commentList = (await comments.json()) as { ticketId: string }[];
    expect(commentList).toHaveLength(1);
    expect(commentList[0]!.ticketId).toBe(ticket.id);

    expect((await getJson(request, `/api/epics?teamId=${recase(team.id)}`, cookie)).status()).toBe(200);
    const epicGet = await getJson(request, `/api/epics/${recase(epic.id)}`, cookie);
    expect(epicGet.status()).toBe(200);
    expect(((await epicGet.json()) as EpicBody).id).toBe(epic.id);

    // Unchanged values sent through upper-case route ids are still no-ops (D7).
    const renamed = await patchJson(request, `/api/teams/${recase(team.id)}`, { name: team.name }, cookie);
    expect(renamed.status()).toBe(200);
    expect((await renamed.json()).modifiedAt).toBe(team.modifiedAt);

    expect((await deleteJson(request, `/api/tickets/${recase(ticket.id)}`, cookie)).status()).toBe(204);
    expect((await getJson(request, `/api/tickets/${ticket.id}`, cookie)).status()).toBe(404);
  });

  test("malformed ids are still 400 VALIDATION_ERROR", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);

    const badRoute = await getJson(request, "/api/tickets/NOT-A-UUID", cookie);
    expect(badRoute.status()).toBe(400);
    expect(await badRoute.json()).toMatchObject({ code: "VALIDATION_ERROR", message: "id must be a valid UUID" });

    const badQuery = await getJson(request, "/api/tickets?teamId=XYZ", cookie);
    expect(badQuery.status()).toBe(400);
    expect(await badQuery.json()).toMatchObject({ code: "VALIDATION_ERROR", message: "teamId must be a valid UUID" });

    const missingQuery = await getJson(request, "/api/epics", cookie);
    expect(missingQuery.status()).toBe(400);
    expect(await missingQuery.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    const badBody = await postJson(
      request,
      "/api/tickets",
      { teamId: team.id, epicId: "ZZZZZZZZ-0000-4000-8000-000000000000", type: "bug", title: "t", body: "b" },
      cookie,
    );
    expect(badBody.status()).toBe(400);
    expect(await badBody.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    const numberId = await postJson(request, "/api/epics", { teamId: 123, title: "t" }, cookie);
    expect(numberId.status()).toBe(400);
    expect(await numberId.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
