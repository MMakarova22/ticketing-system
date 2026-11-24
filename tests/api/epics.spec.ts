import { expect, test } from "../support/test.ts";
import {
  createEpic,
  createTeam,
  deleteJson,
  type EpicBody,
  getJson,
  ISO_UTC,
  MISSING_ID,
  patchJson,
  tick,
  uniqueName,
} from "../support/api.ts";
import { createLoggedInUser, postJson } from "../support/auth.ts";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("epics API", () => {
  test("every route requires a session", async ({ request }) => {
    expect((await request.get(`/api/epics?teamId=${MISSING_ID}`)).status()).toBe(401);
    expect((await request.get(`/api/epics/${MISSING_ID}`)).status()).toBe(401);
    expect((await postJson(request, "/api/epics", { teamId: MISSING_ID, title: "x" })).status()).toBe(401);
    expect((await patchJson(request, `/api/epics/${MISSING_ID}`, { title: "x" })).status()).toBe(401);
    expect((await deleteJson(request, `/api/epics/${MISSING_ID}`)).status()).toBe(401);
  });

  test("create trims title and description and returns ISO timestamps", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id, "  Checkout reliability ", "  Improve errors.  ");
    expect(epic).toMatchObject({
      teamId: team.id,
      title: "Checkout reliability",
      description: "Improve errors.",
      ticketCount: 0,
    });
    expect(epic.createdAt).toMatch(ISO_UTC);
    expect(epic.modifiedAt).toMatch(ISO_UTC);

    const fetched = await getJson(request, `/api/epics/${epic.id}`, cookie);
    expect(fetched.status()).toBe(200);
    expect(await fetched.json()).toEqual(epic);
  });

  test("description is optional; a blank description is stored as null", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    expect((await createEpic(request, cookie, team.id)).description).toBeNull();
    expect((await createEpic(request, cookie, team.id, uniqueName("Epic"), "   ")).description).toBeNull();
  });

  test("create validation: title, teamId and unknown fields (400); unknown team (404)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const invalid = [
      { teamId: team.id },
      { teamId: team.id, title: "   " },
      { teamId: team.id, title: 5 },
      { teamId: team.id, title: "ok", description: 5 },
      { title: "ok" },
      { teamId: "not-a-uuid", title: "ok" },
      { teamId: team.id, title: "ok", extra: true },
    ];
    for (const data of invalid) {
      const response = await postJson(request, "/api/epics", data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    }

    const missingTeam = await postJson(request, "/api/epics", { teamId: MISSING_ID, title: "ok" }, cookie);
    expect(missingTeam.status()).toBe(404);
    expect(await missingTeam.json()).toMatchObject({ statusCode: 404, code: "TEAM_NOT_FOUND" });
  });

  test("list returns only the given team's epics, ordered by title", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const other = await createTeam(request, cookie);
    const b = await createEpic(request, cookie, team.id, "beta");
    const a = await createEpic(request, cookie, team.id, "Alpha");
    await createEpic(request, cookie, other.id, "Gamma");

    const response = await getJson(request, `/api/epics?teamId=${team.id}`, cookie);
    expect(response.status()).toBe(200);
    expect(((await response.json()) as EpicBody[]).map((e) => e.id)).toEqual([a.id, b.id]);

    const empty = await createTeam(request, cookie);
    expect(await (await getJson(request, `/api/epics?teamId=${empty.id}`, cookie)).json()).toEqual([]);
  });

  test("list requires a valid teamId (400) of an existing team (404)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    for (const path of ["/api/epics", "/api/epics?teamId=", "/api/epics?teamId=abc"]) {
      const response = await getJson(request, path, cookie);
      expect(response.status(), path).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    const missing = await getJson(request, `/api/epics?teamId=${MISSING_ID}`, cookie);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "TEAM_NOT_FOUND" });
  });

  test("get: unknown id 404, malformed id 400", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const missing = await getJson(request, `/api/epics/${MISSING_ID}`, cookie);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "EPIC_NOT_FOUND" });
    const malformed = await getJson(request, "/api/epics/xyz", cookie);
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("update title and description; null or blank clears the description", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id, "Payments v2", "Old");
    await tick();

    const updated = await patchJson(request, `/api/epics/${epic.id}`, { title: " Payments v3 ", description: " New " }, cookie);
    expect(updated.status()).toBe(200);
    const body = (await updated.json()) as EpicBody;
    expect(body).toMatchObject({ id: epic.id, teamId: team.id, title: "Payments v3", description: "New" });
    expect(Date.parse(body.modifiedAt)).toBeGreaterThan(Date.parse(epic.modifiedAt));

    const cleared = await patchJson(request, `/api/epics/${epic.id}`, { description: null }, cookie);
    expect((await cleared.json()).description).toBeNull();

    await patchJson(request, `/api/epics/${epic.id}`, { description: "Again" }, cookie);
    const blank = await patchJson(request, `/api/epics/${epic.id}`, { description: "   " }, cookie);
    expect(await blank.json()).toMatchObject({ title: "Payments v3", description: null });
  });

  test("saving unchanged values does not advance modifiedAt (D7)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id, "Fraud detection", "Desc");
    await tick();

    for (const data of [{}, { title: "Fraud detection" }, { title: " Fraud detection ", description: "Desc " }]) {
      const response = await patchJson(request, `/api/epics/${epic.id}`, data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(200);
      expect(await response.json()).toEqual(epic);
    }
    const noDescription = await createEpic(request, cookie, team.id);
    await tick();
    const same = await patchJson(request, `/api/epics/${noDescription.id}`, { description: "" }, cookie);
    expect(await same.json()).toEqual(noDescription);
  });

  test("update validation: team is immutable; blank or null title rejected; unknown id 404", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const other = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);

    for (const data of [{ teamId: other.id }, { title: "  " }, { title: null }, { title: 1 }, { description: 1 }]) {
      const response = await patchJson(request, `/api/epics/${epic.id}`, data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect((await (await getJson(request, `/api/epics/${epic.id}`, cookie)).json()).teamId).toBe(team.id);

    const missing = await patchJson(request, `/api/epics/${MISSING_ID}`, { title: "x" }, cookie);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "EPIC_NOT_FOUND" });
  });

  test("delete removes the epic; unknown id 404, malformed id 400", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);

    expect((await deleteJson(request, `/api/epics/${epic.id}`, cookie)).status()).toBe(204);
    expect((await getJson(request, `/api/epics/${epic.id}`, cookie)).status()).toBe(404);
    const again = await deleteJson(request, `/api/epics/${epic.id}`, cookie);
    expect(again.status()).toBe(404);
    expect(await again.json()).toMatchObject({ code: "EPIC_NOT_FOUND" });
    expect((await deleteJson(request, "/api/epics/nope", cookie)).status()).toBe(400);
    const form = await request.delete(`/api/epics/${MISSING_ID}`, { headers: { Cookie: cookie } });
    expect(form.status()).toBe(415);
  });
});
