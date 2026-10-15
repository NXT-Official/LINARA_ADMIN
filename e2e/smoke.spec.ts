import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { hasAdmin, SIGNED_IN_SCREENS } from "./helpers";

test("the console is kept out of search engines", async ({ page }) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("sign-in shows the brand and the environment", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("img", { name: "Linara" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to the Business Console" }),
  ).toBeVisible();
  await expect(page.getByText(/^(Development|Staging|Production)$/)).toBeVisible();
});

test.describe("signed in", () => {
  test.skip(!hasAdmin, "needs a test admin on linara dev (E2E_ADMIN_* in .env.e2e)");

  for (const [path, heading] of SIGNED_IN_SCREENS) {
    test(`${heading} loads without sideways scrolling`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(/^(Development|Staging|Production)$/)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test("the signed-in admin's email is in the account menu", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: `Account: ${process.env.E2E_ADMIN_EMAIL}` }),
    ).toBeVisible();
  });

  test("Export CSV downloads the list in one click, without contact details", async ({ page }) => {
    await page.goto("/users");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^linara-users-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync(await download.path(), "utf8");
    expect(csv).toContain("user_id,role,suspended");
    expect(csv).not.toContain("@example.com");
  });
});
