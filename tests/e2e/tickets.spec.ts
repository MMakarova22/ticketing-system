import { type Page } from "@playwright/test";
import { expect, test } from "../support/test.ts";
import { MISSING_ID, uniqueName } from "../support/api.ts";
import { createEpicViaUi, createTeamViaUi, loginAsNewUser, openEpicsForTeam } from "../support/ui.ts";

/** Opens the board with the given team selected. */
async function openBoardForTeam(page: Page, teamName: string): Promise<void> {
  await page.goto("/");
  const select = page.getByRole("combobox", { name: "Team" });
  await select.selectOption({ label: teamName });
  await expect(select.locator("option:checked")).toHaveText(teamName);
}

test.describe("tickets and comments", () => {
  test("create, view, comment on, edit and delete a ticket", async ({ page }) => {
    const email = await loginAsNewUser(page);
    const teamA = uniqueName("Alpha");
    const teamB = uniqueName("Beta");
    const epicA = uniqueName("Epic A");
    const epicB = uniqueName("Epic B");
    await createTeamViaUi(page, teamA);
    await createTeamViaUi(page, teamB);
    await openEpicsForTeam(page, teamA);
    await createEpicViaUi(page, epicA);
    await openEpicsForTeam(page, teamB);
    await createEpicViaUi(page, epicB);

    // Board for team A: empty state, then New ticket with team A preselected.
    await openBoardForTeam(page, teamA);
    await expect(page.getByText("No tickets for this team yet.")).toBeVisible();
    await page.getByRole("link", { name: "New ticket" }).click();
    const form = page.getByRole("form", { name: "New ticket" });
    const team = form.getByRole("combobox", { name: "Team" });
    const epic = form.getByRole("combobox", { name: "Epic" });
    await expect(team.locator("option:checked")).toHaveText(teamA);
    // The create form has no state field: new tickets start in "New".
    await expect(form.getByRole("combobox", { name: "State" })).toHaveCount(0);

    // Only the selected team's epics are offered, and a team change clears the epic.
    await expect(epic.locator("option")).toHaveText(["No epic", epicA]);
    await epic.selectOption({ label: epicA });
    await team.selectOption({ label: teamB });
    await expect(epic).toHaveValue("");
    await expect(epic.locator("option")).toHaveText(["No epic", epicB]);
    await team.selectOption({ label: teamA });
    await expect(epic).toHaveValue("");
    await expect(epic.locator("option")).toHaveText(["No epic", epicA]);
    await epic.selectOption({ label: epicA });

    // A whitespace-only body is rejected (D8).
    const title = uniqueName("Checkout fails");
    await form.getByRole("combobox", { name: "Type" }).selectOption({ label: "Bug" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Body").fill("   \n  ");
    await form.getByRole("button", { name: "Create ticket" }).click();
    await expect(form.getByRole("alert")).toHaveText("Enter a ticket body.");
    await form.getByLabel("Body").fill("Steps to reproduce:\n1. Open checkout");
    await form.getByRole("button", { name: "Create ticket" }).click();

    // Details.
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("status")).toHaveText(`Ticket "${title}" created.`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByTestId("ticket-team")).toHaveText(teamA);
    await expect(page.getByTestId("ticket-epic")).toHaveText(epicA);
    await expect(page.getByTestId("ticket-type")).toHaveText("Bug");
    await expect(page.getByTestId("ticket-state")).toHaveText("New");
    await expect(page.getByTestId("ticket-created-by")).toHaveText(email);
    await expect(page.getByTestId("ticket-body")).toHaveText("Steps to reproduce:\n1. Open checkout");
    const modified = await page.getByTestId("ticket-modified").textContent();

    // Comments: blank rejected, then shown oldest first with author and timestamp; no edit/delete controls.
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments.getByText("No comments yet.")).toBeVisible();
    await comments.getByRole("button", { name: "Add comment" }).click();
    await expect(comments.getByRole("alert")).toHaveText("Enter a comment.");
    await comments.getByLabel("Add a comment").fill("First comment");
    await comments.getByRole("button", { name: "Add comment" }).click();
    await expect(comments.getByTestId("comment")).toHaveCount(1);
    await expect(comments.getByLabel("Add a comment")).toHaveValue("");
    await comments.getByLabel("Add a comment").fill("Second comment");
    await comments.getByRole("button", { name: "Add comment" }).click();
    await expect(comments.getByTestId("comment-body")).toHaveText(["First comment", "Second comment"]);
    await expect(comments.getByTestId("comment-author")).toHaveText([email, email]);
    await expect(comments.getByTestId("comment-time").first()).not.toBeEmpty();
    await expect(comments.getByTestId("comment").getByRole("button")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("comment-body")).toHaveText(["First comment", "Second comment"]);
    // Comments never change the ticket's modified time.
    await expect(page.getByTestId("ticket-modified")).toHaveText(modified ?? "");

    // Edit: change state, move to team B (clears the epic), pick team B's epic, rename.
    await page.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("form", { name: "Edit ticket" });
    const editEpic = edit.getByRole("combobox", { name: "Epic" });
    await expect(editEpic.locator("option:checked")).toHaveText(epicA);
    await edit.getByRole("combobox", { name: "State" }).selectOption({ label: "In progress" });
    await edit.getByRole("combobox", { name: "Team" }).selectOption({ label: teamB });
    await expect(editEpic).toHaveValue("");
    await expect(editEpic.locator("option")).toHaveText(["No epic", epicB]);
    await editEpic.selectOption({ label: epicB });
    const newTitle = uniqueName("Checkout fails on Safari");
    await edit.getByLabel("Title").fill(newTitle);
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(`Ticket "${newTitle}" saved.`);
    await expect(page.getByTestId("ticket-team")).toHaveText(teamB);
    await expect(page.getByTestId("ticket-epic")).toHaveText(epicB);
    await expect(page.getByTestId("ticket-state")).toHaveText("In progress");

    await page.reload();
    await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
    await expect(page.getByTestId("ticket-team")).toHaveText(teamB);
    await expect(page.getByTestId("ticket-epic")).toHaveText(epicB);
    await expect(page.getByTestId("ticket-state")).toHaveText("In progress");

    // The board lists it under team B now.
    await page.getByRole("link", { name: "Back to board" }).click();
    const card = page.getByTestId("column-in_progress").getByTestId("ticket-card").filter({ hasText: newTitle });
    await expect(card).toContainText(epicB);
    await card.getByRole("link", { name: newTitle }).click();

    // Delete asks for confirmation (mentioning the comments); dismissing keeps the ticket.
    let confirmText = "";
    page.once("dialog", (dialog) => {
      confirmText = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
    expect(confirmText).toContain("2 comments will be deleted too");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    // The board also renders dnd-kit's own role="status" live region, so narrow to the notice.
    await expect(page.getByRole("status").filter({ hasText: "deleted." })).toHaveText(`Ticket "${newTitle}" deleted.`);
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await expect(page.getByText("No tickets for this team yet.")).toBeVisible();
  });

  test("a blank title is rejected and the board lists the newest change first", async ({ page }) => {
    await loginAsNewUser(page);
    const teamName = uniqueName("Gamma");
    await createTeamViaUi(page, teamName);

    for (const title of ["Older ticket", "Newer ticket"]) {
      await openBoardForTeam(page, teamName);
      await page.getByRole("link", { name: "New ticket" }).click();
      const form = page.getByRole("form", { name: "New ticket" });
      if (title === "Older ticket") {
        await form.getByLabel("Body").fill("Body");
        await form.getByRole("button", { name: "Create ticket" }).click();
        await expect(form.getByRole("alert")).toHaveText("Enter a ticket title.");
      }
      await form.getByLabel("Title").fill(title);
      await form.getByLabel("Body").fill("Body");
      await form.getByRole("button", { name: "Create ticket" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }

    await openBoardForTeam(page, teamName);
    const cards = page.getByTestId("column-new").getByTestId("ticket-card");
    await expect(cards.getByRole("link")).toHaveText(["Newer ticket", "Older ticket"]);
    await expect(cards.first()).toContainText("No epic");

    // The team now has tickets, so it cannot be deleted.
    await page.goto("/teams");
    const teamRow = page.getByTestId("team-row").filter({ hasText: teamName });
    await expect(teamRow.getByRole("cell").nth(1)).toHaveText("2");
    await expect(teamRow.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  test("an unknown ticket shows a not-found screen", async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto(`/tickets/${MISSING_ID}`);
    await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
    await page.getByRole("link", { name: "Go to the board" }).click();
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  });
});
