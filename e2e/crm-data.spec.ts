import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { ADMIN, hasAdmin } from "./helpers";
import { totp } from "./totp";

/**
 * Phase 3b on linara dev: import with a consent basis, the export with contact
 * details behind the two-step code, and both in the audit log (FR-CRM-10,
 * FR-CRM-11). Needs supabase/006-crm-data.sql applied. Deletes what it imports.
 */
test.describe("crm data", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");
  test.skip(({ isMobile }) => isMobile, "desktop only");

  const tableRows = "table tbody tr";

  async function deleteLead(page: Page, name: string) {
    await page.goto("/crm");
    await page.getByLabel("Search name, email, phone or tag").fill(name);
    await page.locator(tableRows).getByRole("link", { name, exact: true }).click();
    await page.getByRole("button", { name: "Delete lead" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete lead" }).click();
    await expect(page).toHaveURL(/\/crm$/);
  }

  test("import two leads from a CSV, duplicates left out", async ({ page }) => {
    const stamp = Date.now();
    const a = `E2E Import A ${stamp}`;
    const b = `E2E Import B ${stamp}`;
    const csv =
      "Name,Email,Phone,Where\r\n" +
      `${a},a${stamp}@example.com,,Facebook\r\n` +
      `${b},,0918 ${String(stamp).slice(-3)} ${String(stamp).slice(-7, -3)},walk-in\r\n` +
      `Dupe One,dupe${stamp}@example.com,,\r\n` +
      `Dupe Two,DUPE${stamp}@example.com,,\r\n`;

    await page.goto("/crm/import");
    await page.getByLabel("CSV file").setInputFiles({
      name: "leads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(page.getByText("4 rows in leads.csv")).toBeVisible();
    await page
      .getByLabel("How these people agreed to be contacted")
      .fill("Asked to be contacted at the E2E expo");
    await page.getByRole("button", { name: "Check rows" }).click();
    await expect(page.getByText("Twice in the file")).toHaveCount(2);
    await page.getByRole("button", { name: "Import 2 leads" }).click();
    await expect(page).toHaveURL(/\/crm$/);

    for (const name of [a, b]) await deleteLead(page, name);
  });

  test("export with contact details needs the code and downloads a file", async ({ page }) => {
    await page.goto("/crm");
    await page.getByRole("radio", { name: "Customers" }).click();
    await page.getByRole("button", { name: "More CRM actions" }).click();
    await page.getByRole("menuitem", { name: "Export with contact details" }).click();
    const dialog = page.getByRole("dialog");
    // A code from the start of a 30-second step, so it can't expire mid-submit.
    const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (secondsLeft < 5) await page.waitForTimeout(secondsLeft * 1000 + 500);
    await dialog.getByLabel("6-digit code").fill(totp(ADMIN.totpSecret));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Export with contact details" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^linara-crm-contacts-with-details-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const text = readFileSync(await download.path(), "utf8");
    expect(text).toContain("contact_id,kind,stage,full_name,email,phone");
    expect(text).toMatch(/@/);
  });

  test("the audit log shows the import and the export", async ({ page }) => {
    await page.goto("/audit");
    await expect(
      page.locator(tableRows).filter({ hasText: "Imported leads" }).first(),
    ).toContainText(ADMIN.email);
    await expect(
      page.locator(tableRows).filter({ hasText: "Exported contacts with details" }).first(),
    ).toContainText(ADMIN.email);
  });
});
