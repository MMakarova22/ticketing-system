import { expect, test } from "../support/test.ts";
import { uniqueName } from "../support/api.ts";
import { createEpicViaUi, createTeamViaUi, loginAsNewUser, openEpicsForTeam } from "../support/ui.ts";

test.describe("team management", () => {
  test("create, rename and delete a team", async ({ page }) => {
    await loginAsNewUser(page);
    const name = uniqueName("Payments");
    await createTeamViaUi(page, name);

    const row = page.getByTestId("team-row").filter({ hasText: name });
    await expect(row.getByRole("cell").nth(1)).toHaveText("0");
    await expect(row.getByRole("cell").nth(2)).toHaveText("0");
    await expect(row.getByRole("cell").nth(3)).toContainText("Today");

    // Rename (inline).
    const renamed = uniqueName("Renamed");
    await row.getByRole("button", { name: "Edit" }).click();
    const input = page.getByRole("textbox", { name: "Team name" });
    await expect(input).toHaveValue(name);
    await input.fill(renamed);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(`Team "${renamed}" saved.`);
    const renamedRow = page.getByTestId("team-row").filter({ hasText: renamed });
    await expect(renamedRow).toBeVisible();

    // Persisted: still there after a reload.
    await page.reload();
    await expect(renamedRow).toBeVisible();

    // Delete asks for confirmation; dismissing keeps the team.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await renamedRow.getByRole("button", { name: "Delete" }).click();
    await expect(renamedRow).toBeVisible();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain(renamed);
      void dialog.accept();
    });
    await renamedRow.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText(`Team "${renamed}" deleted.`);
    await expect(renamedRow).toHaveCount(0);
  });

  test("duplicate names (case-insensitive) and blank names show an error", async ({ page }) => {
    await loginAsNewUser(page);
    const name = uniqueName("Mobile");
    await createTeamViaUi(page, name);

    await page.getByRole("button", { name: "Create team" }).click();
    await page.getByLabel("Team name").fill(`  ${name.toUpperCase()} `);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("A team with this name already exists");

    await page.getByLabel("Team name").fill("   ");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter a team name.");
  });

  test("delete is disabled while the team has epics", async ({ page }) => {
    await loginAsNewUser(page);
    const name = uniqueName("Busy");
    await createTeamViaUi(page, name);
    await openEpicsForTeam(page, name);
    await createEpicViaUi(page, uniqueName("Epic"));

    await page.getByRole("link", { name: "Teams" }).click();
    const row = page.getByTestId("team-row").filter({ hasText: name });
    await expect(row.getByRole("cell").nth(2)).toHaveText("1");
    await expect(row.getByRole("button", { name: "Delete" })).toBeDisabled();
    await expect(page.getByText("Delete is disabled while a team contains tickets or epics.")).toBeVisible();
  });
});
