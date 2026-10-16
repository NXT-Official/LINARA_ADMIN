import { expect, test, type Page } from "@playwright/test";

import { ADMIN, asSecondAdmin, hasAdmin } from "./helpers";
import { totp } from "./totp";

/**
 * Phase 7 on linara dev: roles (§4.2, D39, FR-RL-1 to FR-RL-5). Needs
 * supabase/013-roles.sql and 014-roles-fixes.sql applied. Runs as admin 2:
 * admin 1's specs already spend most of the 5 codes per 15 minutes (D30) that
 * a member gets, and these tests use two more. Member role changes are
 * covered by the SQL and unit tests: changing a test admin's role here would
 * break the specs that run as them.
 */
const ME = asSecondAdmin();
const OTHER = ME === ADMIN ? null : ADMIN;

test.describe("roles", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  // Reads the desktop layout; the phone layout is covered by smoke.spec.ts.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  const unique = () => `E2E role ${Date.now()}`;
  const tableRow = (page: Page, text: string) =>
    page.locator("table tbody tr").filter({ hasText: text });

  let lastStep = -1;
  /**
   * A code for the test admin from a 30-second step not used yet in this test,
   * with at least 5 seconds left, so it is neither a reuse nor about to expire.
   */
  async function freshCode(page: Page) {
    for (;;) {
      const now = Date.now() / 1000;
      const step = Math.floor(now / 30);
      const left = 30 - (now % 30);
      if (step !== lastStep && left >= 5) {
        lastStep = step;
        return totp(ME.totpSecret);
      }
      await page.waitForTimeout((left + 0.5) * 1000);
    }
  }

  /** Unused roles an earlier, interrupted run left behind on linara dev. */
  async function deleteLeftovers(page: Page) {
    for (;;) {
      const leftover = page
        .locator("table tbody tr")
        .filter({ hasText: /^E2E role/ })
        .filter({ hasText: /Custom/ })
        .first();
      if ((await leftover.count()) === 0) return;
      const name = (await leftover.getByRole("button").first().textContent())?.trim() ?? "";
      await leftover.getByRole("button", { name: `Open ${name}` }).click();
      const dialog = page.getByRole("dialog", { name });
      const del = dialog.getByRole("button", { name: "Delete role" });
      if (await del.isDisabled()) {
        await dialog.getByRole("button", { name: "Cancel" }).click();
        return;
      }
      await del.click();
      await dialog.getByRole("button", { name: "Yes, delete" }).click();
      await expect(dialog).toBeHidden();
      await expect(tableRow(page, name)).toHaveCount(0);
    }
  }

  async function openRoles(page: Page) {
    await page.goto("/team?tab=roles");
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Roles" })).toBeChecked();
  }

  test("create a custom role with the code, edit its permissions with the code, rename it, delete it", async ({
    page,
  }) => {
    const name = unique();
    await openRoles(page);
    await deleteLeftovers(page);

    await page.getByRole("button", { name: "New role" }).click();
    let dialog = page.getByRole("dialog", { name: "New role" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("checkbox", { name: "See contacts, activities, follow-ups" }).check();
    // Creating a role is new access, so it needs the code (spec 0.19).
    await dialog.getByLabel("Your two-step code").fill(await freshCode(page));
    await dialog.getByRole("button", { name: "Create role" }).click();
    await expect(dialog).toBeHidden();
    await expect(tableRow(page, name)).toContainText("Custom");

    await tableRow(page, name)
      .getByRole("button", { name: `Open ${name}` })
      .click();
    dialog = page.getByRole("dialog", { name });
    await dialog.getByRole("checkbox", { name: "Support tickets" }).check();
    await dialog.getByLabel("Your two-step code").fill(await freshCode(page));
    await dialog.getByRole("button", { name: "Save role" }).click();
    await expect(dialog).toBeHidden();
    await expect(tableRow(page, name)).toContainText("3 permissions");

    const renamed = `${name} renamed`;
    await tableRow(page, name)
      .getByRole("button", { name: `Open ${name}` })
      .click();
    dialog = page.getByRole("dialog", { name });
    await dialog.getByLabel("Name").fill(renamed);
    await expect(dialog.getByLabel("Your two-step code")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save role" }).click();
    await expect(dialog).toBeHidden();

    await tableRow(page, renamed)
      .getByRole("button", { name: `Open ${renamed}` })
      .click();
    dialog = page.getByRole("dialog", { name: renamed });
    await dialog.getByRole("button", { name: "Delete role" }).click();
    // FR-RL-5: a second step before the role is gone.
    await expect(dialog.getByText("Delete this role? This can't be undone.")).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, delete" }).click();
    await expect(dialog).toBeHidden();
    await expect(tableRow(page, renamed)).toHaveCount(0);

    await page.goto("/audit");
    const rows = page.locator("table tbody tr");
    for (const step of ["Deleted a role", "Changed a role", "Created a role"]) {
      await expect(rows.filter({ hasText: step }).first()).toBeVisible();
    }
  });

  test("a preset is read-only and can be duplicated", async ({ page }) => {
    await openRoles(page);
    await tableRow(page, "Sales").getByRole("button", { name: "Open Sales" }).click();
    const preset = page.getByRole("dialog", { name: "Sales" });
    await expect(preset.getByText("Download contacts as CSV")).toBeVisible();
    await expect(preset.getByRole("checkbox")).toHaveCount(0);
    await preset.getByRole("button", { name: "Duplicate" }).click();
    const editor = page.getByRole("dialog", { name: "New role" });
    await expect(editor.getByLabel("Name")).toHaveValue("Sales copy");
    await expect(editor.getByRole("checkbox", { name: "Download contacts as CSV" })).toBeChecked();
    await editor.getByRole("button", { name: "Cancel" }).click();
    await expect(editor).toBeHidden();
  });

  test("the Team screen shows the test admins as Admin", async ({ page }) => {
    await page.goto("/team");
    await expect(tableRow(page, ME.email)).toContainText("Admin");
    await expect(tableRow(page, ME.email)).toContainText("This is you.");
    if (OTHER) await expect(tableRow(page, OTHER.email)).toContainText("Admin");
  });
});
