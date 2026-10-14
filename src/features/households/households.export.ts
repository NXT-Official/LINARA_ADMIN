import type { Household } from "@/data/types";
import { householdStage } from "@/features/crm/crm-stage";
import { csvDate, type CsvColumn } from "@/lib/csv";

/** For analysis: no household or manager names, no wages (FR-EX-1). */
export const householdCsv = (now: Date): CsvColumn<Household>[] => [
  { header: "household_id", value: (h) => h.id },
  { header: "stage", value: (h) => householdStage(h, now) },
  { header: "managers", value: (h) => h.managers.length },
  { header: "helpers_active", value: (h) => h.helpers.filter((x) => x.status === "ACTIVE").length },
  {
    header: "helpers_invited",
    value: (h) => h.helpers.filter((x) => x.status === "PENDING_CLAIM").length,
  },
  {
    header: "helpers_ended",
    value: (h) => h.helpers.filter((x) => x.status === "INACTIVE").length,
  },
  { header: "tasks_created_7d", value: (h) => h.tasksCreated7d },
  { header: "tasks_done_7d", value: (h) => h.tasksDone7d },
  { header: "last_task", value: (h) => csvDate(h.lastActivityAt) },
  { header: "created", value: (h) => csvDate(h.createdAt) },
];
