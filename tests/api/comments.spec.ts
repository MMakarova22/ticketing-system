import { expect, test } from "../support/test.ts";
import {
  addComment,
  type CommentBody,
  createTeam,
  createTicket,
  deleteJson,
  getJson,
  ISO_UTC,
  MISSING_ID,
  patchJson,
  tick,
} from "../support/api.ts";
import { createLoggedInUser, postJson } from "../support/auth.ts";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("comments API", () => {
  test("every route requires a session", async ({ request }) => {
    expect((await request.get(`/api/tickets/${MISSING_ID}/comments`)).status()).toBe(401);
    expect((await postJson(request, `/api/tickets/${MISSING_ID}/comments`, { body: "x" })).status()).toBe(401);
  });

  test("add: trimmed body, author and timestamp set by the server", async ({ request }) => {
    const { cookie, email } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);

    const comment = await addComment(request, cookie, ticket.id, "  Looks good.\n");
    expect(comment).toMatchObject({ ticketId: ticket.id, body: "Looks good.", author: { email } });
    expect(comment.createdAt).toMatch(ISO_UTC);
  });

  test("list: oldest first, with each comment's author", async ({ request }) => {
    const alice = await createLoggedInUser(request);
    const bob = await createLoggedInUser(request);
    const team = await createTeam(request, alice.cookie);
    const ticket = await createTicket(request, alice.cookie, team.id);

    const first = await addComment(request, alice.cookie, ticket.id, "First");
    await tick();
    const second = await addComment(request, bob.cookie, ticket.id, "Second");
    await tick();
    const third = await addComment(request, alice.cookie, ticket.id, "Third");

    const response = await getJson(request, `/api/tickets/${ticket.id}/comments`, bob.cookie);
    expect(response.status()).toBe(200);
    const comments = (await response.json()) as CommentBody[];
    expect(comments).toEqual([first, second, third]);
    expect(comments.map((c) => c.author.email)).toEqual([alice.email, bob.email, alice.email]);

    const empty = await createTicket(request, alice.cookie, team.id);
    expect(await (await getJson(request, `/api/tickets/${empty.id}/comments`, alice.cookie)).json()).toEqual([]);
  });

  test("validation: blank body and server-owned fields are rejected (400)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);

    const invalid: Record<string, unknown>[] = [
      {},
      { body: "" },
      { body: "  \n\t " },
      { body: null },
      { body: 5 },
      { body: "ok", authorId: MISSING_ID },
      { body: "ok", createdAt: "2020-01-01T00:00:00.000Z" },
      { body: "ok", ticketId: MISSING_ID },
    ];
    for (const data of invalid) {
      const response = await postJson(request, `/api/tickets/${ticket.id}/comments`, data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    }
    expect(await (await getJson(request, `/api/tickets/${ticket.id}/comments`, cookie)).json()).toEqual([]);
  });

  test("unknown ticket 404, malformed ticket id 400", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    for (const response of [
      await getJson(request, `/api/tickets/${MISSING_ID}/comments`, cookie),
      await postJson(request, `/api/tickets/${MISSING_ID}/comments`, { body: "x" }, cookie),
    ]) {
      expect(response.status()).toBe(404);
      expect(await response.json()).toMatchObject({ code: "TICKET_NOT_FOUND" });
    }
    for (const response of [
      await getJson(request, "/api/tickets/abc/comments", cookie),
      await postJson(request, "/api/tickets/abc/comments", { body: "x" }, cookie),
    ]) {
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  test("comments are immutable: there are no update or delete routes", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const ticket = await createTicket(request, cookie, team.id);
    const comment = await addComment(request, cookie, ticket.id, "Original");

    for (const response of [
      await patchJson(request, `/api/tickets/${ticket.id}/comments/${comment.id}`, { body: "Edited" }, cookie),
      await deleteJson(request, `/api/tickets/${ticket.id}/comments/${comment.id}`, cookie),
      await request.put(`/api/tickets/${ticket.id}/comments/${comment.id}`, {
        data: { body: "Edited" },
        headers: { Cookie: cookie },
      }),
      await patchJson(request, `/api/comments/${comment.id}`, { body: "Edited" }, cookie),
      await deleteJson(request, `/api/comments/${comment.id}`, cookie),
      await deleteJson(request, `/api/tickets/${ticket.id}/comments`, cookie),
    ]) {
      expect(response.status(), response.url()).toBe(404);
    }
    expect(await (await getJson(request, `/api/tickets/${ticket.id}/comments`, cookie)).json()).toEqual([comment]);
  });
});
