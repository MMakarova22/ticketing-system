import { expect, test } from "../support/test.ts";
import { uniqueName } from "../support/api.ts";
import { SESSION_COOKIE, TEST_PASSWORD, uniqueEmail } from "../support/auth.ts";
import { card, column, dragCardToColumn } from "../support/board.ts";
import { getVerificationLink } from "../support/mailpit.ts";
import { createEpicViaUi, createTeamViaUi, openEpicsForTeam, verifyAndSetPasswordViaUi } from "../support/ui.ts";

/**
 * Definition of Done (spec §13) as one user journey through the UI: sign-up (email only), email verification with
 * choosing the password (review M1), login, team, epic, ticket create/view/edit, comment, drag-and-drop that survives
 * a reload, delete, logout.
 * It also records every URL, redirect and API response body, and checks that the session token never appears
 * in any of them (the verification token may appear only in the verification link).
 */
test("Definition of Done: full user journey through the UI", async ({ page, context }) => {
  test.setTimeout(90_000);

  // --- Recording (assertions at the end) ------------------------------------------------------------------------
  const navigations: string[] = [];
  const requestUrls: string[] = [];
  const redirects: string[] = [];
  const apiBodies: Promise<string>[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  page.on("request", (request) => requestUrls.push(request.url()));
  page.on("response", (response) => {
    const location = response.headers()["location"];
    if (location) redirects.push(location);
    if (response.url().includes("/api/") && response.status() !== 204) {
      apiBodies.push(response.text().catch(() => ""));
    }
  });

  const email = uniqueEmail("dod");
  const teamName = uniqueName("DoD Team");
  const epicTitle = uniqueName("DoD Epic");
  const title = uniqueName("DoD ticket");
  const body = "Steps to reproduce:\n1. Open the board";
  const startedAt = Date.now();

  // 1. Sign up (email only; the password is chosen from the emailed link).
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  // 2–3. Read the verification email from Mailpit, open its link (rewritten to the tested origin; the token is
  // removed from the address bar) and choose the password.
  const rawLink = await getVerificationLink(email);
  const link = new URL(rawLink);
  expect(link.pathname).toBe("/verify-email");
  expect([...link.searchParams.keys()]).toEqual(["token"]);
  const verificationToken = link.searchParams.get("token")!;
  await verifyAndSetPasswordViaUi(page, rawLink, TEST_PASSWORD);
  expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(false); // no automatic login

  // 4. Log in.
  await page.getByRole("link", { name: "Continue to login" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  await expect(page.getByTestId("user-menu")).toHaveText(email);
  const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
  expect(session, "session cookie after login").toBeTruthy();
  const sessionToken = session!.value;
  expect(sessionToken).not.toBe(verificationToken); // two different tokens with different purposes

  // 5. Create a team.
  await createTeamViaUi(page, teamName);

  // 6. Create an epic in that team.
  await openEpicsForTeam(page, teamName);
  await createEpicViaUi(page, epicTitle, "Epic for the DoD journey");
  await expect(page.getByTestId("epic-row").filter({ hasText: epicTitle })).toBeVisible();

  // 7. Create a ticket linked to the epic, starting from the board of that team.
  await page.goto("/");
  const teamSelect = page.getByRole("combobox", { name: "Team" });
  await teamSelect.selectOption({ label: teamName });
  await expect(teamSelect.locator("option:checked")).toHaveText(teamName);
  await expect(page.getByText("No tickets for this team yet.")).toBeVisible();
  await page.getByRole("link", { name: "New ticket" }).click();
  const form = page.getByRole("form", { name: "New ticket" });
  await expect(form.getByRole("combobox", { name: "Team" }).locator("option:checked")).toHaveText(teamName);
  await form.getByRole("combobox", { name: "Epic" }).selectOption({ label: epicTitle });
  await form.getByRole("combobox", { name: "Type" }).selectOption({ label: "Feature" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Body").fill(body);
  await form.getByRole("button", { name: "Create ticket" }).click();

  // 8. View the ticket details.
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  const ticketPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByTestId("ticket-team")).toHaveText(teamName);
  await expect(page.getByTestId("ticket-epic")).toHaveText(epicTitle);
  await expect(page.getByTestId("ticket-type")).toHaveText("Feature");
  await expect(page.getByTestId("ticket-state")).toHaveText("New");
  await expect(page.getByTestId("ticket-created-by")).toHaveText(email);
  await expect(page.getByTestId("ticket-body")).toHaveText(body);
  await expect(page.locator('dt:text-is("Created") + dd')).not.toBeEmpty();
  await expect(page.getByTestId("ticket-modified")).not.toBeEmpty();

  // 9. Edit the ticket and check the new values, also after a reload.
  const newTitle = uniqueName("DoD ticket edited");
  const newBody = "Updated body after triage.";
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit ticket" });
  await edit.getByRole("combobox", { name: "Type" }).selectOption({ label: "Bug" });
  await edit.getByLabel("Title").fill(newTitle);
  await edit.getByLabel("Body").fill(newBody);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "saved." })).toHaveText(`Ticket "${newTitle}" saved.`);
  for (const pass of ["after save", "after reload"]) {
    if (pass === "after reload") await page.reload();
    await expect(page.getByRole("heading", { name: newTitle }), pass).toBeVisible();
    await expect(page.getByTestId("ticket-type"), pass).toHaveText("Bug");
    await expect(page.getByTestId("ticket-body"), pass).toHaveText(newBody);
    await expect(page.getByTestId("ticket-epic"), pass).toHaveText(epicTitle);
    await expect(page.getByTestId("ticket-state"), pass).toHaveText("New");
  }

  // 10. Add a comment: body, author and timestamp are shown.
  const comments = page.getByRole("region", { name: "Comments" });
  await expect(comments.getByText("No comments yet.")).toBeVisible();
  await comments.getByLabel("Add a comment").fill("Reproduced on staging.");
  await comments.getByRole("button", { name: "Add comment" }).click();
  await expect(comments.getByTestId("comment")).toHaveCount(1);
  await expect(comments.getByTestId("comment-body")).toHaveText("Reproduced on staging.");
  await expect(comments.getByTestId("comment-author")).toHaveText(email);
  const time = comments.getByTestId("comment-time");
  await expect(time).not.toBeEmpty();
  const commentedAt = await time.getAttribute("datetime");
  expect(commentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO-8601 UTC from the server
  expect(Date.parse(commentedAt!)).toBeGreaterThanOrEqual(startedAt - 60_000); // allows for clock skew
  expect(Date.parse(commentedAt!)).toBeLessThanOrEqual(Date.now() + 60_000);

  // 11. Back to the Kanban board: the card is in the "New" column with its type and epic.
  await page.getByRole("link", { name: "Back to board" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  const newCard = card(column(page, "new"), newTitle);
  await expect(newCard).toBeVisible();
  await expect(newCard).toContainText("Bug");
  await expect(newCard).toContainText(epicTitle);

  // 12. Drag the ticket to "In progress"; the server confirms the change.
  const patched = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api${ticketPath}`,
  );
  await dragCardToColumn(page, newCard, column(page, "in_progress"));
  expect((await patched).status()).toBe(200);
  await expect(card(column(page, "in_progress"), newTitle)).toBeVisible();

  // 13. Reload: the new state persisted, on the board and on the ticket page.
  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(card(column(page, "in_progress"), newTitle)).toBeVisible();
  await expect(column(page, "new").getByTestId("ticket-card")).toHaveCount(0);
  await card(column(page, "in_progress"), newTitle).getByRole("link", { name: newTitle }).click();
  await expect(page.getByTestId("ticket-state")).toHaveText("In progress");

  // 14. Delete the ticket: dismissing the confirmation keeps it, accepting deletes it (with its comment).
  let confirmText = "";
  page.once("dialog", (dialog) => {
    confirmText = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
  expect(confirmText).toContain(newTitle);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status").filter({ hasText: "deleted." })).toHaveText(`Ticket "${newTitle}" deleted.`);
  await expect(page.getByText("No tickets for this team yet.")).toBeVisible();
  await page.goto(ticketPath);
  await expect(page.getByText("It may have been deleted.")).toBeVisible();

  // 15. Log out: the cookie is gone and protected screens and API routes are denied.
  await page.getByTestId("user-menu").click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(false);
  await page.goto("/teams");
  await expect(page).toHaveURL(/\/login$/);
  const apiAfterLogout = await page.evaluate(async () => (await fetch("/api/teams")).status);
  expect(apiAfterLogout).toBe(401);

  // --- Token exposure ---------------------------------------------------------------------------------------------
  const bodies = await Promise.all(apiBodies);
  const sessionForms = [sessionToken, encodeURIComponent(sessionToken)];
  for (const [where, values] of [
    ["navigation URL", navigations],
    ["request URL", requestUrls],
    ["redirect Location", redirects],
    ["API response body", bodies],
  ] as const) {
    for (const value of values) {
      for (const form of sessionForms) {
        // The message names where it leaked but never prints the token itself.
        expect(value.includes(form), `the session token appeared in a ${where}`).toBe(false);
      }
    }
  }
  // The verification token appears only in the verification link, never in another URL or an API response.
  for (const url of [...navigations, ...requestUrls, ...redirects]) {
    if (url.includes(verificationToken)) {
      const parsed = new URL(url, page.url());
      expect(parsed.pathname, "verification token outside the verification link").toBe("/verify-email");
      expect(parsed.searchParams.get("token")).toBe(verificationToken);
    }
  }
  for (const responseBody of bodies) {
    expect(responseBody.includes(verificationToken), "verification token in an API response body").toBe(false);
  }
  expect(navigations.some((u) => new URL(u).pathname === "/verify-email" && u.includes(verificationToken))).toBe(true);
  expect(bodies.length).toBeGreaterThan(10); // the recording really covered the journey
});
