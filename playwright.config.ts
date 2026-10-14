import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// The test admin's details, kept out of git (.gitignore covers .env.*).
// Variables already set in the shell win.
if (existsSync(".env.e2e")) process.loadEnvFile(".env.e2e");

/**
 * Browser tests (spec §11). `bun run test:e2e`.
 *
 * - E2E_BASE_URL: the site to test. Unset, it starts the dev server on 8081
 *   (or reuses one already there).
 * - E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_ADMIN_TOTP_SECRET: a dedicated
 *   test admin on linara dev. Without them only the signed-out checks run.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8081";
export const AUTH_FILE = "test-results/.auth/admin.json";

const signedIn = { storageState: AUTH_FILE };

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // The two widths the spec checks: a phone at 360px and a desktop at 1280px.
  projects: [
    { name: "sign-in", testMatch: /sign-in\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, ...signedIn },
      dependencies: ["sign-in"],
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 }, ...signedIn },
      dependencies: ["sign-in"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "bun run dev --port 8081 --strictPort",
        url: `${baseURL}/sign-in`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
