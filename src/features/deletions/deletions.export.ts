import { csvDate, type CsvColumn } from "@/lib/csv";

import type { DeletionRow } from "./deletions.types";

/** For analysis: ids, kinds, statuses and dates only, never a name (FR-EX-1). */
export const DELETION_CSV: CsvColumn<DeletionRow>[] = [
  { header: "request_id", value: (r) => r.requestId },
  { header: "user_id", value: (r) => r.userId },
  { header: "user_type", value: (r) => r.userType ?? "" },
  { header: "status", value: (r) => r.status },
  { header: "requested", value: (r) => csvDate(r.requestedAt) },
  { header: "due", value: (r) => csvDate(r.dueAt) },
  { header: "days_left", value: (r) => (r.status === "pending" ? r.daysLeft : null) },
  { header: "blockers", value: (r) => r.blockers.length },
  { header: "processed", value: (r) => csvDate(r.processedAt) },
];
