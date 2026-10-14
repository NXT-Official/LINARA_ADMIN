import type { Ticket } from "@/data/types";
import { csvDate, type CsvColumn } from "@/lib/csv";

/** For analysis: no subject, details or names (FR-EX-1). */
export const TICKET_CSV: CsvColumn<Ticket>[] = [
  { header: "ticket", value: (t) => `LIN-${t.ref}` },
  { header: "status", value: (t) => t.status },
  { header: "priority", value: (t) => t.priority },
  { header: "channel", value: (t) => t.channel },
  { header: "category", value: (t) => t.category },
  { header: "assigned", value: (t) => !!t.assigneeId },
  { header: "linked_user", value: (t) => !!t.userId },
  { header: "notes", value: (t) => t.notes.length },
  { header: "created", value: (t) => csvDate(t.createdAt) },
  { header: "updated", value: (t) => csvDate(t.updatedAt) },
];
