import { expect, test } from "../support/test.ts";
import {
  createEpic,
  createTeam,
  deleteJson,
  getJson,
  ISO_UTC,
  MISSING_ID,
  patchJson,
  type TeamBody,
  tick,
  uniqueName,
} from "../support/api.ts";
import { createLoggedInUser, postJson } from "../support/auth.ts";

test.use({ storageState: { cookies: [], origins: [] } });

async function listTeams(request: Parameters<typeof getJson>[0], cookie: string): Promise<TeamBody[]> {
  const response = await getJson(request, "/api/teams", cookie);
  expect(response.status()).toBe(200);
  return (await response.json()) as TeamBody[];
}

test.describe("teams API", () => {
  test("every route requires a session", async ({ request }) => {
    expect((await request.get("/api/teams")).status()).toBe(401);
    expect((await postJson(request, "/api/teams", { name: uniqueName() })).status()).toBe(401);
    expect((await patchJson(request, `/api/teams/${MISSING_ID}`, { name: uniqueName() })).status()).toBe(401);
    expect((await deleteJson(request, `/api/teams/${MISSING_ID}`)).status()).toBe(401);
  });

  test("state-changing requests must be JSON (415)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const form = { headers: { Cookie: cookie }, form: { name: "x" } };
    expect((await request.post("/api/teams", form)).status()).toBe(415);
    expect((await request.patch(`/api/teams/${team.id}`, form)).status()).toBe(415);
    const del = await request.delete(`/api/teams/${team.id}`, { headers: { Cookie: cookie } });
    expect(del.status()).toBe(415);
    expect(await del.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  test("create trims the name and returns counts and ISO timestamps; the team is listed", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const name = uniqueName("Payments");
    const team = await createTeam(request, cookie, `   ${name}  `);
    expect(team).toMatchObject({ name, ticketCount: 0, epicCount: 0 });
    expect(team.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(team.createdAt).toMatch(ISO_UTC);
    expect(team.modifiedAt).toMatch(ISO_UTC);

    const listed = (await listTeams(request, cookie)).find((t) => t.id === team.id);
    expect(listed).toEqual(team);
  });

  test("invalid names and unknown fields are rejected with 400", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    for (const data of [{}, { name: "" }, { name: "   \t " }, { name: 42 }, { name: null }, { name: uniqueName(), extra: 1 }]) {
      const response = await postJson(request, "/api/teams", data, cookie);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    }
    const team = await createTeam(request, cookie);
    const blank = await patchJson(request, `/api/teams/${team.id}`, { name: "  " }, cookie);
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("names are unique case-insensitively after trimming (409)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const name = uniqueName("Mobile Apps");
    await createTeam(request, cookie, name);

    const duplicate = await postJson(request, "/api/teams", { name: `  ${name.toUpperCase()} ` }, cookie);
    expect(duplicate.status()).toBe(409);
    expect(await duplicate.json()).toMatchObject({ statusCode: 409, code: "TEAM_NAME_TAKEN" });

    const other = await createTeam(request, cookie);
    const rename = await patchJson(request, `/api/teams/${other.id}`, { name: name.toLowerCase() }, cookie);
    expect(rename.status()).toBe(409);
    expect(await rename.json()).toMatchObject({ code: "TEAM_NAME_TAKEN" });
  });

  test("rename advances modifiedAt; saving the same name does not (D7)", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);

    await tick();
    const same = await patchJson(request, `/api/teams/${team.id}`, { name: `  ${team.name}  ` }, cookie);
    expect(same.status()).toBe(200);
    expect(await same.json()).toEqual(team);

    await tick();
    const newName = uniqueName("Renamed");
    const renamed = await patchJson(request, `/api/teams/${team.id}`, { name: newName }, cookie);
    expect(renamed.status()).toBe(200);
    const body = (await renamed.json()) as TeamBody;
    expect(body.name).toBe(newName);
    expect(body.createdAt).toBe(team.createdAt);
    expect(Date.parse(body.modifiedAt)).toBeGreaterThan(Date.parse(team.modifiedAt));
  });

  test("a team can change only the case of its own name", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie, uniqueName("internal tools"));
    await tick();
    const response = await patchJson(request, `/api/teams/${team.id}`, { name: team.name.toUpperCase() }, cookie);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as TeamBody;
    expect(body.name).toBe(team.name.toUpperCase());
    expect(Date.parse(body.modifiedAt)).toBeGreaterThan(Date.parse(team.modifiedAt));
  });

  test("unknown ids return 404 and malformed ids return 400", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const patch = await patchJson(request, `/api/teams/${MISSING_ID}`, { name: uniqueName() }, cookie);
    expect(patch.status()).toBe(404);
    expect(await patch.json()).toMatchObject({ statusCode: 404, code: "TEAM_NOT_FOUND" });
    const del = await deleteJson(request, `/api/teams/${MISSING_ID}`, cookie);
    expect(del.status()).toBe(404);
    expect(await del.json()).toMatchObject({ code: "TEAM_NOT_FOUND" });

    for (const response of [
      await patchJson(request, "/api/teams/not-a-uuid", { name: uniqueName() }, cookie),
      await deleteJson(request, "/api/teams/123", cookie),
    ]) {
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  test("an empty team can be deleted", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const response = await deleteJson(request, `/api/teams/${team.id}`, cookie);
    expect(response.status()).toBe(204);
    expect((await listTeams(request, cookie)).some((t) => t.id === team.id)).toBe(false);
    expect((await deleteJson(request, `/api/teams/${team.id}`, cookie)).status()).toBe(404);
  });

  test("a team with epics cannot be deleted (409) until the epics are gone", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    const epic = await createEpic(request, cookie, team.id);

    const blocked = await deleteJson(request, `/api/teams/${team.id}`, cookie);
    expect(blocked.status()).toBe(409);
    const body = await blocked.json();
    expect(body).toMatchObject({ statusCode: 409, code: "TEAM_IN_USE" });
    expect(body.message).toContain("1 epic");
    expect((await listTeams(request, cookie)).some((t) => t.id === team.id)).toBe(true);

    expect((await deleteJson(request, `/api/epics/${epic.id}`, cookie)).status()).toBe(204);
    expect((await deleteJson(request, `/api/teams/${team.id}`, cookie)).status()).toBe(204);
  });

  test("epic count follows epics, without changing the team's modifiedAt", async ({ request }) => {
    const { cookie } = await createLoggedInUser(request);
    const team = await createTeam(request, cookie);
    await tick();
    await createEpic(request, cookie, team.id);
    await createEpic(request, cookie, team.id);

    const listed = (await listTeams(request, cookie)).find((t) => t.id === team.id);
    expect(listed).toMatchObject({ epicCount: 2, ticketCount: 0, modifiedAt: team.modifiedAt });
  });
});
