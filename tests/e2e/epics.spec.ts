import { expect, test } from "../support/test.ts";
import { uniqueName } from "../support/api.ts";
import { createEpicViaUi, createTeamViaUi, loginAsNewUser, openEpicsForTeam } from "../support/ui.ts";

test.describe("epic management", () => {
  test("create, edit and delete an epic for the selected team", async ({ page }) => {
    await loginAsNewUser(page);
    const team = uniqueName("Payments");
    await createTeamViaUi(page, team);
    await openEpicsForTeam(page, team);
    await expect(page.getByText("No epics for this team yet.")).toBeVisible();

    const title = uniqueName("Checkout reliability");
    await createEpicViaUi(page, title, "Improve checkout errors and recovery.");
    const row = page.getByTestId("epic-row").filter({ hasText: title });
    await expect(row).toContainText("Improve checkout errors and recovery.");
    await expect(row.getByRole("cell").nth(1)).toHaveText("0");

    // The selected team is in the URL, so a reload keeps it.
    await expect(page).toHaveURL(/\/epics\?teamId=[0-9a-f-]{36}$/);
    await page.reload();
    await expect(row).toBeVisible();

    // Edit: the team is shown read-only.
    await row.getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("form", { name: "Edit epic" });
    await expect(form).toContainText(`Team: ${team} (an epic's team cannot be changed)`);
    await expect(form.getByLabel("Title")).toHaveValue(title);
    const newTitle = uniqueName("Payments v2");
    await form.getByLabel("Title").fill(newTitle);
    await form.getByLabel("Description (optional)").fill("");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(`Epic "${newTitle}" saved.`);
    const editedRow = page.getByTestId("epic-row").filter({ hasText: newTitle });
    await expect(editedRow).not.toContainText("Improve checkout");

    // Blank title is rejected in the form.
    await editedRow.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Title").fill("  ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter an epic title.");
    await page.getByRole("button", { name: "Cancel" }).click();

    // Delete with confirmation.
    page.once("dialog", (dialog) => void dialog.accept());
    await editedRow.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText(`Epic "${newTitle}" deleted.`);
    await expect(page.getByText("No epics for this team yet.")).toBeVisible();
  });

  test("the team selector shows only that team's epics", async ({ page }) => {
    await loginAsNewUser(page);
    const teamA = uniqueName("Alpha");
    const teamB = uniqueName("Beta");
    await createTeamViaUi(page, teamA);
    await createTeamViaUi(page, teamB);

    const epicA = uniqueName("Epic A");
    const epicB = uniqueName("Epic B");
    await openEpicsForTeam(page, teamA);
    await createEpicViaUi(page, epicA);
    await openEpicsForTeam(page, teamB);
    await createEpicViaUi(page, epicB);

    await expect(page.getByTestId("epic-row")).toHaveText([new RegExp(epicB)]);
    await page.getByRole("combobox", { name: "Team" }).selectOption({ label: teamA });
    await expect(page.getByTestId("epic-row")).toHaveText([new RegExp(epicA)]);
  });
});
