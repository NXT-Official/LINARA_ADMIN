import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test as setup, type Page } from "@playwright/test";

import { AUTH_FILE, AUTH_FILE_2 } from "../playwright.config";
import { ADMIN, ADMIN2, hasAdmin, hasAdmin2, passCaptcha, waitForLiveForm } from "./helpers";
import { totp } from "./totp";

/**
 * Signs a test admin in once and saves the session for the other tests.
 * Reuses a session saved in the last 25 minutes, so test runs don't spend the
 * admin's 5 sign-ins per 15 minutes (D30) or trip the 30-minute idle limit.
 */
async function signIn(page: Page, admin: typeof ADMIN, has: boolean, file: string) {
  mkdirSync(dirname(file), { recursive: true });
  if (!has) {
    writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 25 * 60_000) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw.cookies?.length) return;
  }

  await page.goto("/sign-in");
  await waitForLiveForm(page);
  await page.getByLabel("Work email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await passCaptcha(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/sign-in/two-step");
  // A code from the start of a 30-second step, so it can't expire mid-submit.
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsLeft < 5) await page.waitForTimeout(secondsLeft * 1000 + 500);
  await page.locator("input[autocomplete='one-time-code']").fill(totp(admin.totpSecret));
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await page.context().storageState({ path: file });
}

setup("sign in as the test admin", async ({ page }) => {
  await signIn(page, ADMIN, hasAdmin, AUTH_FILE);
});

setup("sign in as the second test admin", async ({ page }) => {
  await signIn(page, ADMIN2, hasAdmin2, AUTH_FILE_2);
});
