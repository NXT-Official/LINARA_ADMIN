import { expect, test, type Page } from "@playwright/test";

import { asSecondAdmin, hasAdmin } from "./helpers";

const ADMIN = asSecondAdmin();

/**
 * Phase 5 on linara dev: logging and handling tickets, tickets on a user's
 * page and the dashboard's support figures (FR-SP-1 to FR-SP-7, FR-DB-5).
 * Needs supabase/010-support.sql applied. Tickets can't be deleted, so each
 * test closes the ticket it makes.
 */
test.describe("support", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  // Reads the desktop layout; the phone layout is covered by smoke.spec.ts.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  const tableRows = "table tbody tr";
  const unique = () => `E2E ticket ${Date.now()}`;

  async function fillTicket(page: Page, subject: string) {
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Subject").fill(subject);
    await dialog.getByLabel("What they need").fill("Asked on Viber why a payout hasn't arrived");
    await dialog.getByRole("button", { name: "Log ticket" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
  }

  async function closeTicket(page: Page) {
    await page.getByRole("radio", { name: "Closed", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Closed", exact: true })).toBeChecked();
  }

  test("log a ticket, add a note, assign it, resolve and reopen it, then close it", async ({
    page,
  }) => {
    const subject = unique();
    await page.goto("/support");
    await page.getByRole("button", { name: "Log ticket" }).click();
    await fillTicket(page, subject);

    await page.getByLabel("Add a note").fill("Checked the payout run, it went out today");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Checked the payout run, it went out today")).toBeVisible();

    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByRole("button", { name: "Assign to me" })).toHaveCount(0);

    const status = (name: string) => page.getByRole("radio", { name, exact: true });
    await status("Resolved").click();
    await expect(status("Resolved")).toBeChecked();
    await status("Open").click();
    await expect(status("Open")).toBeChecked();
    await closeTicket(page);

    // Each step is in the ticket's history, by the test admin.
    await page.reload();
    const history = page.locator("section", { hasText: "History in the console" }).first();
    for (const step of [
      "logged a ticket",
      "added a note to a ticket",
      "assigned a ticket",
      "changed a ticket's status",
    ]) {
      await expect(history).toContainText(step);
    }
    await expect(history).toContainText(ADMIN.email);
  });

  test("a ticket linked to a user shows on the user's page", async ({ page }) => {
    await page.goto("/users");
    const user = page.locator(tableRows).first().getByRole("link").first();
    await user.click();
    await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}$/);
    const userUrl = page.url();

    const subject = unique();
    await page.getByRole("button", { name: "Log ticket" }).click();
    await fillTicket(page, subject);

    await page.goto(userUrl);
    const link = page.getByRole("link").filter({ hasText: subject });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
    await closeTicket(page);
  });

  test("the dashboard's support figures link to the list", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Open tickets/ }).click();
    await expect(page).toHaveURL(/\/support\?status=open$/);
    await expect(page.getByRole("radio", { name: "Open", exact: true })).toBeChecked();

    await page.goto("/");
    await page.getByRole("link", { name: /^Not assigned/ }).click();
    await expect(page).toHaveURL(/\/support\?status=active&assignee=unassigned$/);
  });
});
