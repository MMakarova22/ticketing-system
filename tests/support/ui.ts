import { expect, type Page } from "@playwright/test";
import { registerAndVerify, TEST_PASSWORD, uniqueEmail } from "./auth.ts";

/**
 * Opens the emailed verification link (rewritten to the tested origin in case APP_BASE_URL differs), checks that the
 * token is removed from the address bar, then chooses the password (review M1) and waits for the success screen.
 */
export async function verifyAndSetPasswordViaUi(page: Page, link: string, password = TEST_PASSWORD): Promise<void> {
  const url = new URL(link);
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email$/); // token removed from the address bar
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Verify email and set password" }).click();
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
}

/** Creates a verified user via the API, then logs in through the login screen. Returns the email. */
export async function loginAsNewUser(page: Page): Promise<string> {
  const email = uniqueEmail("e2e");
  await registerAndVerify(page.request, email);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("user-menu")).toHaveText(email);
  return email;
}

/** Creates a team through the Teams screen and waits until it is listed. */
export async function createTeamViaUi(page: Page, name: string): Promise<void> {
  await page.goto("/teams");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByLabel("Team name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(`Team "${name}" created.`);
  await expect(page.getByTestId("team-row").filter({ hasText: name })).toBeVisible();
}

/** Opens the Epics screen with the given team selected. */
export async function openEpicsForTeam(page: Page, teamName: string): Promise<void> {
  await page.goto("/epics");
  const select = page.getByRole("combobox", { name: "Team" });
  await select.selectOption({ label: teamName });
  await expect(select.locator("option:checked")).toHaveText(teamName);
}

/** Creates an epic for the selected team through the Epics screen. */
export async function createEpicViaUi(page: Page, title: string, description = ""): Promise<void> {
  await page.getByRole("button", { name: "Create epic" }).click();
  await page.getByLabel("Title").fill(title);
  if (description) {
    await page.getByLabel("Description (optional)").fill(description);
  }
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(`Epic "${title}" created.`);
}
