import { expect, test, type Page } from "@playwright/test";

import { asSecondAdmin, hasAdmin } from "./helpers";

const ADMIN = asSecondAdmin();

/**
 * Phase 3a on linara dev: leads, activities, follow-ups, stages, customers and
 * the CRM figures (FR-CRM-1 to FR-CRM-8, FR-DB-7). Needs supabase/004-crm.sql
 * applied. Each test deletes the lead it makes.
 */
test.describe("crm", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  // Reads the desktop table; the phone layout is covered by smoke.spec.ts.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  const tableRows = "table tbody tr";
  const unique = () => `E2E Lead ${Date.now()}`;

  async function addLead(page: Page, name: string) {
    await page.goto("/crm");
    await page.getByRole("button", { name: "Add lead" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Phone").fill("0918 000 0000");
    await dialog.getByRole("button", { name: "Add lead" }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel("Search name, email, phone or tag").fill(name);
    const link = page.locator(tableRows).getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  }

  async function deleteLead(page: Page) {
    await page.getByRole("button", { name: "Delete lead" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete lead" }).click();
    await expect(page).toHaveURL(/\/crm$/);
  }

  test("add a lead, log a call, set a follow-up, mark it done, delete it", async ({ page }) => {
    const name = unique();
    await addLead(page, name);

    await page.getByRole("button", { name: "Log activity" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("What was said").fill("Asked about a live-in helper");
    await dialog.getByRole("button", { name: "Log activity" }).click();
    await expect(page.getByText("Asked about a live-in helper")).toBeVisible();

    await page.getByRole("button", { name: "Add follow-up" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("What to do").fill("Send the price list");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Due").fill(tomorrow);
    await dialog.getByRole("button", { name: "Add follow-up" }).click();
    await expect(page.getByText("Send the price list")).toBeVisible();
    await page.getByRole("button", { name: "Mark done: Send the price list" }).click();
    await expect(page.getByRole("button", { name: "Mark done: Send the price list" })).toHaveCount(
      0,
    );

    // Each step is in the contact's history, by the test admin.
    const history = page
      .getByRole("region", { name: "History in the console" })
      .or(page.locator("section", { hasText: "History in the console" }));
    await expect(history.first()).toContainText(ADMIN.email);

    await deleteLead(page);
  });

  test("a lost lead needs a reason", async ({ page }) => {
    await addLead(page, unique());
    await page.getByRole("radio", { name: "Lost" }).click();
    const dialog = page.getByRole("dialog");
    const submit = dialog.getByRole("button", { name: "Mark as lost" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Why").fill("Went with an agency");
    await submit.click();
    await expect(page.getByText("Lost: Went with an agency")).toBeVisible();
    await deleteLead(page);
  });

  test("managers are listed as customers", async ({ page }) => {
    await page.goto("/crm");
    await page.getByRole("radio", { name: "Customers" }).click();
    const first = page.locator(tableRows).first();
    await expect(first).toContainText("Customer");
    await first.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/crm\/(account\/)?[0-9a-f-]{36}$/);
    await expect(page.getByText("Linara account")).toBeVisible();
  });

  test("dashboard CRM figures link to the list", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: /^New/ }).click();
    await expect(page).toHaveURL(/\/crm\?.*kind=lead/);
    await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  });
});
