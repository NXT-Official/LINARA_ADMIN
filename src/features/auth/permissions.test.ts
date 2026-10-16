import { describe, expect, it } from "vitest";

import { PERMISSION_GROUPS, PERMISSION_LABEL, PERMISSIONS, can } from "./permissions";

describe("can (D39)", () => {
  it("can checks the list", () => {
    const list = ["dashboard.view", "crm.view"];
    expect(can(list, "crm.view")).toBe(true);
    expect(can(list, "crm.write")).toBe(false);
    expect(can(PERMISSIONS, "team.manage")).toBe(true);
  });

  it("gives an account without a console role nothing", () => {
    expect(can(null, "dashboard.view")).toBe(false);
    expect(can(undefined, "crm.view")).toBe(false);
    expect(can([], "dashboard.view")).toBe(false);
  });
});

describe("permission editor data (FR-RL-3)", () => {
  it("groups cover every permission but team.manage, once each", () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(PERMISSIONS.filter((p) => p !== "team.manage").sort());
    expect(PERMISSION_GROUPS.map((g) => g.label)).toEqual(["Customers", "Operations", "Admin"]);
  });

  it("labels exist for every permission", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABEL[p]).toMatch(/^[A-Z]/);
    expect(PERMISSION_LABEL["pay.view"]).toBe("Reveal wages, payslip amounts, payout accounts");
  });
});
