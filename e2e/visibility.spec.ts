import { expect, test } from "@playwright/test";

import { ADMIN, hasAdmin } from "./helpers";

/**
 * Phase 2 on linara dev: Dashboard, Users and Households read real data, and
 * revealing pay is recorded (FR-DB-1, FR-US-1 to FR-US-6, FR-HH-1, FR-HH-2).
 * Needs supabase/002-visibility.sql applied to linara dev.
 */
test.describe("visibility", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  // Reads the desktop table; the phone layout is covered by smoke.spec.ts.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  // The desktop table; DataTable also renders stacked cards for phones.
  const tableRows = "table tbody tr";

  test("users list shows real accounts and opens one", async ({ page }) => {
    await page.goto("/users");
    const first = page.locator(tableRows).first().getByRole("link").first();
    await expect(first).toBeVisible();
    const name = (await first.textContent())?.trim() ?? "";
    await first.click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Arrives with Support (Phase 5).")).toBeVisible();
  });

  test("household search narrows the list", async ({ page }) => {
    await page.goto("/households");
    const first = page.locator(tableRows).first().getByRole("link").first();
    await expect(first).toBeVisible();
    const name = (await first.textContent())?.trim() ?? "";
    await page.getByLabel("Search household name").fill(name.slice(0, 3));
    await expect(page.locator(tableRows).getByRole("link", { name, exact: true })).toBeVisible();
  });

  test("revealing a wage is recorded", async ({ page }) => {
    await page.goto("/users");
    await page.getByRole("radio", { name: "Helpers" }).click();
    // Wait for the filtered list: the previous rows stay on screen while it loads.
    const firstRow = page.locator(tableRows).first();
    await expect(firstRow).toContainText("Helper");
    await firstRow.getByRole("link").first().click();
    await expect(page.getByText("Every household this helper works or worked in.")).toBeVisible();
    const show = page.getByRole("button", { name: /monthly wage$/ }).first();
    if (!(await show.isVisible().catch(() => false))) {
      test.skip(true, "this helper has no job");
    }
    await show.click();
    await expect(page.getByRole("button", { name: /monthly wage$/ })).toHaveCount(0);

    // Other tests write audit entries at the same time: find this one, not the newest.
    await page.goto("/audit");
    const reveal = page.locator(tableRows).filter({ hasText: "Revealed pay details" }).first();
    await expect(reveal).toContainText(ADMIN.email);
  });

  test("a made-up user id shows User not found", async ({ page }) => {
    await page.goto("/users/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { level: 1, name: "User not found" })).toBeVisible();
  });

  test("dashboard numbers are not sample data", async ({ page }) => {
    await page.goto("/households");
    await expect(page.locator(tableRows).first()).toBeVisible();
    // linara dev has fewer than 50 households: one page holds them all.
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
    const listed = await page.locator(tableRows).count();

    await page.goto("/");
    // The figure, not the sidebar link of the same name.
    const figure = page.getByRole("main").getByRole("link", { name: /^Households/ });
    await expect(figure).toContainText(String(listed));
    await expect(page.getByText("Support tickets: arrive in Phase 5")).toBeVisible();
  });
});
