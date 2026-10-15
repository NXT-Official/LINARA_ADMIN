import { csvDate, type CsvColumn } from "@/lib/csv";

import type { HouseholdRow } from "./households.types";

/** For analysis: no household or manager names, no wages (FR-EX-1). */
export const HOUSEHOLD_CSV: CsvColumn<HouseholdRow>[] = [
  { header: "household_id", value: (h) => h.householdId },
  { header: "managers", value: (h) => h.managers },
  { header: "helpers_active", value: (h) => h.helpersActive },
  { header: "tasks_scheduled_7d", value: (h) => h.tasksScheduled7d },
  { header: "tasks_done_7d", value: (h) => h.tasksDone7d },
  { header: "last_activity", value: (h) => csvDate(h.lastActivityAt) },
  { header: "created", value: (h) => csvDate(h.createdAt) },
];
