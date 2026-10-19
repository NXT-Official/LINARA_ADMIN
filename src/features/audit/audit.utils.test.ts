import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { actionLabel, TARGET_LABEL, targetHref } from "./audit.utils";

describe("actionLabel (FR-AU-1)", () => {
  it("the CRM export has a label", () => {
    expect(actionLabel("crm.exported")).not.toBe("crm.exported");
  });

  it("every action the CRM's SQL records has a plain label", () => {
    const sql = ["004-crm.sql", "006-crm-data.sql"]
      .map((f) => readFileSync(resolve(__dirname, "../../../supabase", f), "utf8"))
      .join("\n");
    const actions = [...new Set(sql.match(/'crm\.[a-z_]+'/g)?.map((a) => a.slice(1, -1)) ?? [])];
    expect(actions.length).toBeGreaterThanOrEqual(11);
    expect(actions.filter((a) => actionLabel(a) === a)).toEqual([]);
  });

  it("every action Support's SQL records has a plain label (D37)", () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/010-support.sql"), "utf8");
    const actions = [
      ...new Set(sql.match(/'support\.[a-z_]+'/g)?.map((a) => a.slice(1, -1)) ?? []),
    ];
    expect(actions.length).toBeGreaterThanOrEqual(6);
    expect(actions.filter((a) => actionLabel(a) === a)).toEqual([]);
  });

  it("every role and staff action has a label (D39)", () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/013-roles.sql"), "utf8");
    const actions = [
      ...new Set(sql.match(/'(role|staff)\.[a-z_]+'/g)?.map((a) => a.slice(1, -1)) ?? []),
    ];
    expect(actions.length).toBeGreaterThanOrEqual(6);
    expect(actions.filter((a) => actionLabel(a) === a)).toEqual([]);
    expect(actionLabel("staff.added")).toBe("Added a team member");
  });

  it("a role audit entry links to the Roles tab (FR-AU-2)", () => {
    expect(targetHref({ targetType: "role", targetId: "r1" })).toBe("/team?tab=roles");
    expect(targetHref({ targetType: "staff", targetId: "u1" })).toBe("/team");
  });

  it("every target the business SQL (015 to 020) records has a filter label", () => {
    const sql = [
      "016-billing-plans.sql",
      "017-billing-subscriptions.sql",
      "018-billing-finance.sql",
    ]
      .map((f) => readFileSync(resolve(__dirname, "../../../supabase", f), "utf8"))
      .join("\n");
    const targets = [
      ...new Set(
        [...sql.matchAll(/billing_audit\(p_actor, '[a-z_.]+', '([a-z_]+)'/g)].map((m) => m[1]!),
      ),
    ];
    expect(targets.sort()).toEqual(
      ["cost", "household", "invoice", "model_price", "plan", "settings", "subscription"].sort(),
    );
    expect(targets.filter((t) => !TARGET_LABEL[t])).toEqual([]);
    expect(TARGET_LABEL.faq).toBe("FAQ");
  });

  it("business entries link to their pages; a subscription has none of its own", () => {
    expect(targetHref({ targetType: "plan", targetId: "p1" })).toBe("/plans");
    expect(targetHref({ targetType: "faq", targetId: "f1" })).toBe("/faqs");
    expect(targetHref({ targetType: "cost", targetId: "c1" })).toBe("/finance");
    expect(targetHref({ targetType: "model_price", targetId: "gpt-x" })).toBe("/finance");
    expect(targetHref({ targetType: "subscription", targetId: "s1" })).toBeNull();
  });

  it("has no label for an action nothing records", () => {
    expect(actionLabel("ticket.assigned")).toBe("ticket.assigned");
  });
});
