import { expect, test } from "@playwright/test";

const SCREENS = [
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

for (const [path, heading] of SCREENS) {
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

test("Export CSV downloads the list in one click, without contact details", async ({ page }) => {
  await page.goto("/users");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^linara-users-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const csv = (await import("node:fs")).readFileSync(path, "utf8");
  expect(csv).toContain("user_id,role,status");
  expect(csv).not.toContain("@example.com");
});
