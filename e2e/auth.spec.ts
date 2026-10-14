import { expect, test } from "@playwright/test";

import { hasAdmin, passCaptcha, SIGNED_IN_SCREENS, waitForLiveForm } from "./helpers";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed-out visitors are sent to sign-in", async ({ page }) => {
    for (const [path] of SIGNED_IN_SCREENS) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
      await expect(
        page.getByRole("heading", { name: "Sign in to the Business Console" }),
      ).toBeVisible();
    }
  });

  test("the console sends a CSP and no-store", async ({ page }) => {
    const res = await page.goto("/sign-in");
    const h = res?.headers() ?? {};
    // The dev server reports CSP violations instead of blocking; builds enforce (S-14).
    const csp = h["content-security-policy-report-only"] ?? h["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h["cache-control"]).toBe("no-store");
    expect(h["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("no CSP violations while loading sign-in", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    await page.goto("/sign-in", { waitUntil: "networkidle" });
    await expect(page.locator('iframe[src*="hcaptcha"]').first()).toBeAttached();
    // Vite's own dev scripts are reported in development; ignore those.
    expect(violations.filter((v) => !/@vite|@react-refresh|vite\/client/.test(v))).toEqual([]);
  });

  test("a wrong password shows the generic message", async ({ page }) => {
    test.skip(!hasAdmin, "needs the linara dev backend (E2E_ADMIN_* set)");
    await page.goto("/sign-in");
    await waitForLiveForm(page);
    // A made-up address: it doesn't spend the test admin's sign-in attempts.
    await page.getByLabel("Work email").fill(`nobody+${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("not the password");
    await passCaptcha(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
  });
});
