import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (spec §11). `bun run test:e2e`.
 *
 * E2E_BASE_URL: the site to test. Unset, it starts the dev server on 8081
 * (or reuses one already there).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8081";

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
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "bun run dev --port 8081 --strictPort",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
