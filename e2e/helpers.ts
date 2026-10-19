import { test, type Page } from "@playwright/test";

import { AUTH_FILE_2 } from "../playwright.config";

export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "",
  password: process.env.E2E_ADMIN_PASSWORD ?? "",
  totpSecret: process.env.E2E_ADMIN_TOTP_SECRET ?? "",
};
export const hasAdmin = Boolean(ADMIN.email && ADMIN.password && ADMIN.totpSecret);

export const ADMIN2 = {
  email: process.env.E2E_ADMIN2_EMAIL ?? "",
  password: process.env.E2E_ADMIN2_PASSWORD ?? "",
  totpSecret: process.env.E2E_ADMIN2_TOTP_SECRET ?? "",
};
export const hasAdmin2 = Boolean(ADMIN2.email && ADMIN2.password && ADMIN2.totpSecret);

/**
 * Runs the calling spec file as the second test admin, when there is one, and
 * returns whichever admin it runs as. Call at the top of the file. The files
 * alternate between admins in run order (D30's limit is per admin).
 */
export function asSecondAdmin(): typeof ADMIN {
  if (!hasAdmin2) return ADMIN;
  test.use({ storageState: AUTH_FILE_2 });
  return ADMIN2;
}

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
  ["/plans", "Plans"],
  ["/finance", "Finance"],
  ["/faqs", "FAQs"],
  ["/team", "Team"],
] as const;
