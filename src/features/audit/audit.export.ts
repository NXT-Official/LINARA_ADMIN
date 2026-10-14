import type { CsvColumn } from "@/lib/csv";

import type { AuditRow } from "./audit.handlers.server";

/** For analysis: the reason is free text, so it stays out (FR-EX-1). */
export const AUDIT_CSV: CsvColumn<AuditRow>[] = [
  { header: "entry_id", value: (e) => e.id },
  { header: "action", value: (e) => e.action },
  { header: "admin_id", value: (e) => e.actorId },
  { header: "target_type", value: (e) => e.targetType },
  { header: "target_id", value: (e) => e.targetId },
  { header: "at", value: (e) => e.at },
];
