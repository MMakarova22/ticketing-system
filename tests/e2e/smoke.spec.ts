import { expect, test } from "../support/test.ts";
import { loginAsNewUser } from "../support/ui.ts";

test.describe("app shell", () => {
  test("loads the SPA and reaches the API through the same origin", async ({ page }) => {
    await loginAsNewUser(page);
    await expect(page.getByText("Ticket Tracker")).toBeVisible();
    // The board loads its team list from /api: it shows either a team selector or the "no teams" state.
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Team" }).or(page.getByText("there are no teams yet")),
    ).toBeVisible();
  });

  test("navigates between sections and supports deep links", async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto("/epics");
    await expect(page.getByRole("heading", { name: "Epics" })).toBeVisible();

    await page.getByRole("link", { name: "Teams" }).click();
    await expect(page).toHaveURL(/\/teams$/);
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
  });
});
