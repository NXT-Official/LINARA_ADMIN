import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv";

import { METRIC_COLUMNS, metricRows } from "./dashboard-metrics";
import type { DashboardData } from "./dashboard.types";

const data: DashboardData = {
  households: 12,
  householdsNew7d: 1,
  householdsNew30d: 3,
  householdsActive7d: 5,
  managers: 9,
  managersMultiHome: 2,
  helpersActive: 6,
  helpersInvited: 1,
  helpersEnded: 2,
  newHouseholdsWeekly: [{ weekStart: "2026-10-12", count: 1 }],
  tasksDoneDaily: [{ day: "2026-10-15", count: 4 }],
};

describe("metricRows (FR-EX-1, FR-EX-2)", () => {
  it("metric rows cover the nine numbers in snake_case", () => {
    const rows = metricRows(data, new Date("2026-10-15T04:00:00Z"));
    expect(rows.map((r) => r.metric)).toEqual([
      "households",
      "households_new_7d",
      "households_new_30d",
      "households_active_7d",
      "managers",
      "managers_multi_home",
      "helpers_active",
      "helpers_invited",
      "helpers_ended",
    ]);
    expect(rows[0]).toEqual({ date: "2026-10-15", metric: "households", value: 12 });
  });

  it("the dashboard export is numbers only", () => {
    const csv = toCsv(METRIC_COLUMNS, metricRows(data, new Date("2026-10-15T04:00:00Z")));
    expect(csv.split("\r\n")).toHaveLength(10);
    expect(csv).not.toMatch(/@|week_start|tasks_done_daily/);
  });
});
