import { csvDate, type CsvColumn } from "@/lib/csv";

import { ticketRef } from "./support.input";
import type { TicketRow } from "./support.types";

/** For analysis: no subject, details, contact handle or names (FR-EX-1). */
export const TICKET_CSV: CsvColumn<TicketRow>[] = [
  { header: "ticket", value: (t) => ticketRef(t.ref) },
  { header: "status", value: (t) => t.status },
  { header: "priority", value: (t) => t.priority },
  { header: "channel", value: (t) => t.channel },
  { header: "category", value: (t) => t.category },
  { header: "assignee_id", value: (t) => t.assigneeId ?? "" },
  { header: "linked_user", value: (t) => !!t.userId },
  { header: "linked_household", value: (t) => !!t.householdId },
  { header: "linked_contact", value: (t) => !!t.contactId },
  { header: "notes", value: (t) => t.noteCount },
  { header: "created", value: (t) => csvDate(t.createdAt) },
  { header: "resolved", value: (t) => csvDate(t.resolvedAt) },
];
