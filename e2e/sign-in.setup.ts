import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { AUTH_FILE } from "../playwright.config";
import { ADMIN, hasAdmin, passCaptcha, waitForLiveForm } from "./helpers";
import { totp } from "./totp";

/**
 * Signs the test admin in once and saves the session for the other tests.
 * Reuses a session saved in the last 25 minutes, so test runs don't spend the
 * admin's 5 sign-ins per 15 minutes (D30) or trip the 30-minute idle limit.
 */
setup("sign in as the test admin", async ({ page }) => {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  if (!hasAdmin) {
    writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  if (existsSync(AUTH_FILE) && Date.now() - statSync(AUTH_FILE).mtimeMs < 25 * 60_000) {
    const raw = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
    if (raw.cookies?.length) return;
  }

  await page.goto("/sign-in");
  await waitForLiveForm(page);
  await page.getByLabel("Work email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await passCaptcha(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/sign-in/two-step");
  // A code from the start of a 30-second step, so it can't expire mid-submit.
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsLeft < 5) await page.waitForTimeout(secondsLeft * 1000 + 500);
  await page.locator("input[autocomplete='one-time-code']").fill(totp(ADMIN.totpSecret));
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
