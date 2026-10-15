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
});
