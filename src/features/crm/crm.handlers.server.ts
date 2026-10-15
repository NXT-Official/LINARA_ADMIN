import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid, PAGE_SIZE, pageWindow, parsePage, parseSearch } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { STAGE_DAYS } from "./crm-stage";
import {
  CUSTOMER_STAGES,
  LEAD_STAGES,
  MANAGER_ROLES,
  type ContactDetail,
  type ContactKind,
  type ContactRef,
  type ContactRow,
  type CrmDashboard,
  type LinkSuggestion,
  type ManagerRole,
} from "./crm.types";

/** The CRM screens (§5.2, D31, D34): one function call each after the guard. */

export async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("crm", e);
    return toPublicError(e);
  }
}

/** The stage limits and clock every stage-aware function takes (D16). */
export function stageWindow() {
  return {
    p_now: new Date().toISOString(),
    p_active_days: STAGE_DAYS.active,
    p_at_risk_days: STAGE_DAYS.atRisk,
  };
}

const TAG = /^[A-Za-z0-9 _-]{1,30}$/;
const bad = (message: string) => new ConsoleError("invalid_input", message);

export type DbContactRow = {
  contact_id: string | null;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  kind: ContactKind;
  stage: ContactRow["stage"];
  source: ContactRow["source"];
  owner_id: string | null;
  tags: string[] | null;
  roles: ManagerRole[] | null;
  household_count: number;
  next_follow_up_at: string | null;
  created_at: string;
};

export function toContactRow(r: DbContactRow): ContactRow {
  return {
    contactId: r.contact_id,
    userId: r.user_id,
    fullName: r.full_name ?? "No name",
    email: r.email,
    phone: r.phone,
    kind: r.kind,
    stage: r.stage,
    source: r.source,
    ownerId: r.owner_id,
    tags: r.tags ?? [],
    roles: r.roles ?? [],
    householdCount: r.household_count,
    nextFollowUpAt: r.next_follow_up_at,
    createdAt: r.created_at,
  };
}

type DbContactDetail = DbContactRow & {
  lead_stage: ContactDetail["leadStage"];
  lost_reason: string | null;
  consent_basis: string | null;
  linked_at: string | null;
  households: {
    household_id: string;
    name: string;
    role: ManagerRole;
    stage: ContactDetail["households"][number]["stage"];
    last_activity_at: string | null;
  }[];
  activities: {
    id: string;
    kind: ContactDetail["activities"][number]["kind"];
    body: string | null;
    occurred_at: string;
    author_id: string;
  }[];
  follow_ups: {
    id: string;
    due_at: string;
    note: string;
    assignee_id: string;
    done_at: string | null;
  }[];
};

export function toContactDetail(d: DbContactDetail): ContactDetail {
  return {
    ...toContactRow(d),
    leadStage: d.lead_stage,
    lostReason: d.lost_reason,
    consentBasis: d.consent_basis,
    linkedAt: d.linked_at,
    households: d.households.map((h) => ({
      householdId: h.household_id,
      name: h.name,
      role: h.role,
      stage: h.stage,
      lastActivityAt: h.last_activity_at,
    })),
    activities: d.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      body: a.body ?? "",
      occurredAt: a.occurred_at,
      authorId: a.author_id,
    })),
    followUps: d.follow_ups.map((f) => ({
      id: f.id,
      dueAt: f.due_at,
      note: f.note,
      assigneeId: f.assignee_id,
      doneAt: f.done_at,
    })),
  };
}

export type ListContactsInput = {
  page: number;
  search?: string;
  kind?: ContactKind;
  stage?: string;
  owner?: "mine";
  tag?: string;
  role?: ManagerRole;
  due?: "today" | "overdue";
};

export type ContactFilters = Omit<ListContactsInput, "page">;

/** The list's filters, checked: shared by the list and the export (FR-CRM-11). */
export function checkContactFilters(input: ContactFilters) {
  const search = parseSearch(input.search);
  const tag = input.tag?.trim() || null;
  if (input.kind !== undefined && input.kind !== "lead" && input.kind !== "customer") {
    throw bad("Pick leads or customers.");
  }
  const stages: readonly string[] = [...LEAD_STAGES, ...CUSTOMER_STAGES];
  if (input.stage !== undefined && !stages.includes(input.stage)) throw bad("Pick a stage.");
  if (tag !== null && !TAG.test(tag)) throw bad("Tags are up to 30 letters, numbers or dashes.");
  if (input.role !== undefined && !MANAGER_ROLES.includes(input.role)) throw bad("Pick a role.");
  if (input.due !== undefined && input.due !== "today" && input.due !== "overdue") {
    throw bad("Pick today or overdue.");
  }
  if (input.owner !== undefined && input.owner !== "mine") throw bad("Pick an owner.");
  return {
    search,
    tag,
    kind: input.kind ?? null,
    stage: input.stage ?? null,
    role: input.role ?? null,
    due: input.due ?? null,
    mine: input.owner === "mine",
  };
}

/** crm_list_contacts' filter arguments; "mine" becomes the caller's id. */
export function filterArgs(f: ReturnType<typeof checkContactFilters>, staffUserId: string) {
  return {
    p_search: f.search,
    p_kind: f.kind,
    p_stage: f.stage,
    p_owner: f.mine ? staffUserId : null,
    p_tag: f.tag,
    p_role: f.role,
    p_due: f.due,
  };
}

export function listContactsHandler(
  input: ListContactsInput,
): Promise<{ ok: true; contacts: ContactRow[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    const page = parsePage(input.page);
    const filters = checkContactFilters(input);

    const staff = await requireStaff("crm.view");
    const { data, error } = await getAdminClient().rpc("crm_list_contacts", {
      ...filterArgs(filters, staff.userId),
      ...pageWindow(page),
      ...stageWindow(),
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DbContactRow[];
    return {
      ok: true as const,
      hasMore: rows.length > PAGE_SIZE,
      contacts: rows.slice(0, PAGE_SIZE).map(toContactRow),
    };
  });
}

const NOT_FOUND = "There's no contact with this address.";

export function getContactHandler(
  ref: ContactRef,
): Promise<{ ok: true; contact: ContactDetail } | PublicError> {
  return run(async () => {
    const contactId = "contactId" in ref ? ref.contactId : null;
    const userId = "userId" in ref ? ref.userId : null;
    if (!isUuid(contactId ?? userId)) throw new ConsoleError("not_found", NOT_FOUND);
    await requireStaff("crm.view");

    const { data, error } = await getAdminClient().rpc("crm_get_contact", {
      p_contact_id: contactId,
      p_user_id: userId,
      ...stageWindow(),
    });
    if (error) throw new Error(error.message);
    if (!data) throw new ConsoleError("not_found", NOT_FOUND);
    return { ok: true as const, contact: toContactDetail(data as DbContactDetail) };
  });
}

export function linkSuggestionsHandler(input: {
  contactId: string;
}): Promise<{ ok: true; suggestions: LinkSuggestion[] } | PublicError> {
  return run(async () => {
    if (!isUuid(input.contactId)) throw new ConsoleError("not_found", NOT_FOUND);
    await requireStaff("crm.view");
    const { data, error } = await getAdminClient().rpc("crm_link_suggestions", {
      p_contact_id: input.contactId,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { user_id: string; full_name: string | null; email: string }[];
    return {
      ok: true as const,
      suggestions: rows.map((r) => ({ userId: r.user_id, fullName: r.full_name, email: r.email })),
    };
  });
}

export function crmDashboardHandler(): Promise<{ ok: true; crm: CrmDashboard } | PublicError> {
  return run(async () => {
    await requireStaff("crm.view");
    const { data, error } = await getAdminClient().rpc("crm_dashboard", stageWindow());
    if (error || !data) throw new Error(error?.message ?? "crm_dashboard returned nothing");
    const d = data as {
      leads_by_stage: CrmDashboard["leadsByStage"];
      customers_by_stage: CrmDashboard["customersByStage"];
      follow_ups_due_today: number;
      follow_ups_overdue: number;
      converted_30d: number;
      sources: CrmDashboard["sources"];
    };
    return {
      ok: true as const,
      crm: {
        leadsByStage: d.leads_by_stage,
        customersByStage: d.customers_by_stage,
        followUpsDueToday: d.follow_ups_due_today,
        followUpsOverdue: d.follow_ups_overdue,
        converted30d: d.converted_30d,
        sources: d.sources,
      },
    };
  });
}
