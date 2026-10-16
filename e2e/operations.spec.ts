import { expect, test, type Page } from "@playwright/test";

import { asSecondAdmin, hasAdmin } from "./helpers";

asSecondAdmin();

/**
 * Phase 6 on linara dev: payout problems and AI usage, read only (FR-PO-1 to
 * FR-PO-3, FR-AI-1, FR-AI-2, FR-DB-6). Needs supabase/012-operations.sql
 * applied. The console can't create payouts or AI calls, so these tests read
 * whatever linara dev holds and skip what it doesn't have.
 */
test.describe("operations", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  // Reads the desktop layout; the phone layout is covered by smoke.spec.ts.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  const tableRows = "table tbody tr";
  const main = (page: Page) => page.getByRole("main");

  test("payouts page loads from live data and filters by kind", async ({ page }) => {
    await page.goto("/payouts");
    await expect(page.getByRole("heading", { level: 1, name: "Payouts" })).toBeVisible();
    const table = main(page).getByRole("table", { name: "Payouts with a problem" });
    const empty = main(page).getByText("No payout problems");
    await expect(table.or(empty).first()).toBeVisible();
    await expect(main(page).getByText("The payouts didn't load")).toHaveCount(0);

    await page.getByRole("radio", { name: "Stuck sending" }).click();
    await expect(page.getByRole("radio", { name: "Stuck sending" })).toBeChecked();
    await expect(table.or(empty).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Check at Xendit/i })).toHaveCount(0);
  });

  test("revealing an amount is in the audit log", async ({ page }) => {
    await page.goto("/payouts");
    const show = page.locator(tableRows).getByRole("button", { name: /^Show .* payout amount$/ });
    await expect(show.or(main(page).getByText("No payout problems")).first()).toBeVisible();
    test.skip((await show.count()) === 0, "linara dev has no payout problems");

    await show.first().click();
    await expect(page.locator(tableRows).first()).toContainText("₱");
    await page.goto("/audit");
    await expect(page.locator(tableRows).first()).toContainText("Revealed pay details");
  });

  test("AI usage page loads with its 48-hour note", async ({ page }) => {
    await page.goto("/ai");
    await expect(page.getByRole("heading", { level: 1, name: "AI usage" })).toBeVisible();
    await expect(page.getByText(/keeps AI call records for 48 hours/)).toBeVisible();
    await expect(page.getByText(/Cost isn't recorded/)).toBeVisible();
    await expect(page.getByText("Calls per hour")).toBeVisible();
    await expect(page.getByText("AI usage didn't load")).toHaveCount(0);
  });

  test("dashboard operations figures link to their pages", async ({ page }) => {
    await page.goto("/");
    const stuck = main(page).getByRole("link", { name: /^Stuck sending/ });
    await expect(stuck).toBeVisible();
    await stuck.click();
    await expect(page).toHaveURL(/\/payouts\?kind=stuck$/);
    await expect(page.getByRole("radio", { name: "Stuck sending" })).toBeChecked();

    await page.goto("/");
    await main(page)
      .getByRole("link", { name: /^AI calls in 24 hours/ })
      .click();
    await expect(page).toHaveURL(/\/ai$/);
  });
});
