import type { Page } from "@playwright/test";

export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "",
  password: process.env.E2E_ADMIN_PASSWORD ?? "",
  totpSecret: process.env.E2E_ADMIN_TOTP_SECRET ?? "",
};
export const hasAdmin = Boolean(ADMIN.email && ADMIN.password && ADMIN.totpSecret);

/**
 * Waits until the form is live: the hCaptcha widget only renders after React
 * has hydrated, and typing before that is wiped by hydration.
 */
export async function waitForLiveForm(page: Page) {
  await page.locator('iframe[src*="hcaptcha"][title*="checkbox" i]').waitFor();
}

/** Ticks hCaptcha's checkbox. With the test site key it always passes. */
export async function passCaptcha(page: Page) {
  const frame = page.frameLocator('iframe[src*="hcaptcha"][title*="checkbox" i]');
  await frame.locator("#checkbox").click();
  await page.getByRole("button", { name: /Continue|Send reset link/ }).isEnabled();
}

export const SIGNED_IN_SCREENS = [
  ["/", "Dashboard"],
  ["/crm", "CRM"],
  ["/users", "Users"],
  ["/households", "Households"],
  ["/support", "Support"],
  ["/deletions", "Deletion requests"],
  ["/payouts", "Payouts"],
  ["/ai", "AI usage"],
  ["/audit", "Audit log"],
  ["/team", "Admins"],
] as const;
