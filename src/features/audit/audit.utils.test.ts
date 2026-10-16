import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { actionLabel } from "./audit.utils";

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

  it("has no label for an action nothing records", () => {
    expect(actionLabel("ticket.assigned")).toBe("ticket.assigned");
  });
});
