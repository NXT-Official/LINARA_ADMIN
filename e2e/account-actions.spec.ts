import { expect, test, type Page } from "@playwright/test";

import { ADMIN, hasAdmin } from "./helpers";
import { totp } from "./totp";

/**
 * Phase 4 on linara dev: deletion requests and suspension (FR-DL-1, FR-DL-7,
 * FR-US-4, FR-DB-4). Needs supabase/008-account-actions.sql applied. No test
 * processes a deletion request: it deletes a real account and can't be undone.
 */
test.describe("account actions", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  test.skip(({ isMobile }) => isMobile, "desktop only");

  const SUSPEND_USER = process.env.E2E_SUSPEND_USER_ID ?? "";

  /** A code from the start of a 30-second step, so it can't expire mid-submit. */
  async function freshCode(page: Page) {
    const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (secondsLeft < 5) await page.waitForTimeout(secondsLeft * 1000 + 500);
    return totp(ADMIN.totpSecret);
  }

  test("the deletions screen shows waiting requests or says there are none", async ({ page }) => {
    await page.goto("/deletions");
    await expect(page.getByRole("heading", { level: 1, name: "Deletion requests" })).toBeVisible();
    await expect(
      page.locator("table tbody tr").first().or(page.getByText("No requests waiting")),
    ).toBeVisible();
    await page.getByRole("radio", { name: "History" }).click();
    await expect(
      page.locator("table tbody tr").first().or(page.getByText("No finished requests yet")),
    ).toBeVisible();
  });

  test("the dashboard shows deletion figures", async ({ page }) => {
    await page.goto("/");
    const figure = page.getByRole("main").getByRole("link", { name: /^Deletion requests waiting/ });
    await expect(figure).toHaveAttribute("href", "/deletions");
  });

  test("suspend and unsuspend a test user", async ({ page }) => {
    test.skip(!SUSPEND_USER, "set E2E_SUSPEND_USER_ID to a throwaway linara dev account");
    await page.goto(`/users/${SUSPEND_USER}`);

    for (const action of ["Suspend", "Unsuspend"] as const) {
      await page.getByRole("button", { name: action, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Reason").fill(`E2E ${action.toLowerCase()} check`);
      await dialog.getByLabel("6-digit code").fill(await freshCode(page));
      await dialog.getByRole("button", { name: action, exact: true }).click();
      await expect(dialog).toBeHidden();
      // The code just used can't be used again in the same step.
      await page.waitForTimeout(31_000);
    }
    await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
  });
});
