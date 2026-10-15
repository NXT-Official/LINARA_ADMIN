import { csvDate, type CsvColumn } from "@/lib/csv";

import type { ContactExportRow } from "./crm.data.server";
import type { ContactRow } from "./crm.types";

/**
 * The one-click CRM export for analysis (FR-EX-1): kinds, stages, sources,
 * owners and dates, keyed by id. No name, email, phone, tag text or other free
 * text; those need the export with contact details and the two-step code
 * (FR-CRM-11, Phase 3b).
 */
export const CONTACT_CSV: CsvColumn<ContactRow>[] = [
  { header: "contact_id", value: (c) => c.contactId ?? "" },
  { header: "user_id", value: (c) => c.userId ?? "" },
  { header: "kind", value: (c) => c.kind },
  { header: "stage", value: (c) => c.stage },
  { header: "source", value: (c) => c.source ?? (c.kind === "customer" ? "signed_up" : "") },
  { header: "owner_id", value: (c) => c.ownerId ?? "" },
  // Tags are typed by admins and can hold a name ("referral-Santos"), so only the count.
  { header: "tag_count", value: (c) => c.tags.length },
  { header: "households", value: (c) => c.householdCount },
  { header: "next_follow_up", value: (c) => csvDate(c.nextFollowUpAt) },
  { header: "created", value: (c) => csvDate(c.createdAt) },
];

/**
 * The export with contact details (FR-CRM-11): only after the two-step code,
 * recorded in the audit log. Cells are still escaped against formulas (S-19).
 */
export const CONTACT_DETAILS_CSV: CsvColumn<ContactExportRow>[] = [
  { header: "contact_id", value: (c) => c.contactId ?? "" },
  { header: "kind", value: (c) => c.kind },
  { header: "stage", value: (c) => c.stage },
  { header: "full_name", value: (c) => c.fullName },
  { header: "email", value: (c) => c.email ?? "" },
  { header: "phone", value: (c) => c.phone ?? "" },
  { header: "source", value: (c) => c.source ?? "" },
  { header: "owner_id", value: (c) => c.ownerId ?? "" },
  { header: "tags", value: (c) => c.tags.join(", ") },
  { header: "created", value: (c) => csvDate(c.createdAt) },
];
