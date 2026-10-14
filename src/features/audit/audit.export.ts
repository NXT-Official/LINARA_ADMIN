import { staffById } from "@/data/queries";
import type { AuditEntry } from "@/data/types";
import type { CsvColumn } from "@/lib/csv";

/** For analysis: the reason is free text, so it stays out (FR-EX-1). */
export const AUDIT_CSV: CsvColumn<AuditEntry>[] = [
  { header: "entry_id", value: (e) => e.id },
  { header: "action", value: (e) => e.action },
  { header: "admin", value: (e) => staffById(e.actorId)?.fullName ?? "" },
  { header: "target_type", value: (e) => e.targetType },
  { header: "target_id", value: (e) => e.targetId },
  { header: "at", value: (e) => e.at },
];
