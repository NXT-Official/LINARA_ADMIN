import { deletionDaysLeft } from "@/data/queries";
import type { DeletionRequest } from "@/data/types";
import { csvDate, type CsvColumn } from "@/lib/csv";

/** For analysis: ids and dates only (FR-EX-1). */
export const deletionCsv = (now: Date): CsvColumn<DeletionRequest>[] => [
  { header: "request_id", value: (r) => r.id },
  { header: "kind", value: (r) => r.kind },
  { header: "status", value: (r) => r.status },
  { header: "requested", value: (r) => csvDate(r.requestedAt) },
  {
    header: "days_left",
    value: (r) => (r.status === "pending" ? deletionDaysLeft(r.requestedAt, now) : null),
  },
  { header: "blockers", value: (r) => r.blockers.length },
  { header: "finished", value: (r) => csvDate(r.finishedAt) },
];
