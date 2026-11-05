import { writeAudit } from "@/features/audit/audit.server";
import { checkRateLimit } from "@/features/auth/rate-limit.server";
import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import { notifyContactsExported } from "@/features/team/team-notify.server";
import { ConsoleError, type PublicError } from "@/lib/console-error";
import { getAdminClient } from "@/lib/supabase-admin.server";

import {
  checkContactFilters,
  filterArgs,
  run,
  stageWindow,
  toContactRow,
  type ContactFilters,
  type DbContactRow,
} from "./crm.handlers.server";
import { normalisePhone, parseLeadInput, type LeadInput } from "./crm.input";
import { MAX_IMPORT_ROWS } from "./crm.import";
import type { ContactRow } from "./crm.types";

/** CRM data in and out (FR-CRM-10, FR-CRM-11, S-5, S-18, S-24). */

const MAX_EXPORT_ROWS = 5000;
const bad = (message: string) => new ConsoleError("invalid_input", message);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

// ---------------------------------------------------------------- Duplicates

export function findDuplicatesHandler(input: {
  emails: string[];
  phones: string[];
}): Promise<{ ok: true; matches: { email: string | null; phone: string | null }[] } | PublicError> {
  return run(async () => {
    const emails = [
      ...new Set((input.emails ?? []).map((e) => String(e).trim().toLowerCase())),
    ].filter((e) => e && e.length <= 254);
    const phones = [
      ...new Set((input.phones ?? []).map((p) => normalisePhone(String(p))).filter(Boolean)),
    ] as string[];
    if (emails.length > MAX_IMPORT_ROWS || phones.length > MAX_IMPORT_ROWS) {
      throw bad(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
    }
    await requireStaff("crm.write");
    const rows = await call<{ email: string | null; phone: string | null }[]>(
      "crm_find_duplicates",
      { p_emails: emails, p_phones: phones },
    );
    return {
      ok: true as const,
      matches: (rows ?? []).map((r) => ({ email: r.email, phone: r.phone })),
    };
  });
}

// ---------------------------------------------------------------- Import

export function importLeadsHandler(input: {
  rows: LeadInput[];
  consentBasis: string;
}): Promise<{ ok: true; imported: number } | PublicError> {
  return run(async () => {
    const consent = String(input.consentBasis ?? "").trim();
    if (consent.length < 5 || consent.length > 300) {
      throw bad("Say how these people agreed to be contacted (5 to 300 characters).");
    }
    const rows = input.rows ?? [];
    if (rows.length === 0) throw bad("There's nothing to import.");
    if (rows.length > MAX_IMPORT_ROWS)
      throw bad(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
    // Every row is checked again here; one bad row stops the whole import.
    const clean = rows.map((row, i) => {
      try {
        return parseLeadInput(row);
      } catch (e) {
        const message = e instanceof ConsoleError ? e.publicMessage : "Check this row.";
        throw bad(`Row ${i + 1}: ${message}`);
      }
    });

    const staff = await requireStaff("crm.write");
    const imported = await call<number>("crm_import_leads", {
      p_actor: staff.userId,
      p_rows: clean.map((r) => ({
        full_name: r.fullName,
        email: r.email,
        phone: r.phone,
        source: r.source,
        tags: r.tags,
        note: r.note,
      })),
      p_consent: consent,
    });
    return { ok: true as const, imported };
  });
}

// ---------------------------------------------------------------- Export with contact details

export type ContactExportRow = Pick<
  ContactRow,
  | "contactId"
  | "kind"
  | "stage"
  | "fullName"
  | "email"
  | "phone"
  | "source"
  | "ownerId"
  | "tags"
  | "createdAt"
>;

export function exportContactsHandler(input: {
  filters: ContactFilters;
  code: string;
}): Promise<{ ok: true; rows: ContactExportRow[] } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("crm.export");
    const filters = checkContactFilters(input.filters ?? {});
    await checkRateLimit("export", { adminId: staff.userId });
    // Personal details leave the console only after the code again (S-5, S-18).
    await requireFreshCode(staff, input.code);

    // One JSON value, not a table: the API caps how many table rows it returns
    // (Max rows), and a silently shorter file would mislead (FR-CRM-11).
    const data = await call<{ total: number; rows: DbContactRow[] }>("crm_export_contacts", {
      ...filterArgs(filters, staff.userId),
      p_max: MAX_EXPORT_ROWS,
      ...stageWindow(),
    });
    if (data.total > MAX_EXPORT_ROWS) {
      throw bad("More than 5,000 contacts match. Narrow the filters, then export again.");
    }
    const rows = (data.rows ?? []).map(toContactRow);
    if (rows.length !== data.total) {
      throw new Error(`export returned ${rows.length} of ${data.total} rows`);
    }

    // Recorded before the file leaves the server; which filters were on, never the search text.
    await writeAudit({
      actorId: staff.userId,
      action: "crm.exported",
      targetType: "export",
      targetId: "crm-contacts-with-details",
      metadata: {
        rows: rows.length,
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.stage ? { stage: filters.stage } : {}),
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.due ? { due: filters.due } : {}),
        ...(filters.mine ? { owner_mine: true } : {}),
        ...(filters.search || filters.tag ? { has_search: true } : {}),
      },
    });
    // Every team manager hears about it (FR-CRM-11, S-18, D45).
    await notifyContactsExported({ actorEmail: staff.email, rows: rows.length });

    return {
      ok: true as const,
      rows: rows.map((r) => ({
        contactId: r.contactId,
        kind: r.kind,
        stage: r.stage,
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
        source: r.source,
        ownerId: r.ownerId,
        tags: r.tags,
        createdAt: r.createdAt,
      })),
    };
  });
}
