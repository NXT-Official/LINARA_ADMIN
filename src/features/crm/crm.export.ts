import type { ContactRow } from "@/data/queries";
import { staffById } from "@/data/queries";
import { csvDate, type CsvColumn } from "@/lib/csv";

/**
 * The one-click CRM export for analysis (FR-EX-1): stages, sources, owners
 * and dates, keyed by id. No name, email, phone, tag text or other free text; those need the
 * "Export with contact details" flow and the two-step code (FR-CRM-11).
 */
export const CONTACT_CSV: CsvColumn<ContactRow>[] = [
  { header: "contact_id", value: (c) => c.id },
  { header: "kind", value: (c) => c.kind },
  { header: "stage", value: (c) => c.stage },
  { header: "source", value: (c) => c.source ?? (c.kind === "customer" ? "signed_up" : "") },
  { header: "owner", value: (c) => staffById(c.ownerId)?.fullName ?? "" },
  { header: "linked_account", value: (c) => !!c.userId },
  // Tags are typed by admins and can hold a name ("referral-Santos"), so they stay out.
  { header: "tag_count", value: (c) => c.tags.length },
  { header: "activities", value: (c) => c.activities.length },
  { header: "open_follow_ups", value: (c) => c.followUps.filter((f) => !f.doneAt).length },
  { header: "next_follow_up", value: (c) => csvDate(c.nextFollowUp?.dueAt) },
  { header: "created", value: (c) => csvDate(c.createdAt) },
];
