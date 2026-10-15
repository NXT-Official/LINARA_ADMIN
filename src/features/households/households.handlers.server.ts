import { requireStaff } from "@/features/auth/session.server";
import type { Employment, HelperStatus, UserKind } from "@/features/users/users.types";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid, PAGE_SIZE, pageWindow, parsePage, parseSearch } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import type { HouseholdDetail, HouseholdRow } from "./households.types";

/** The Households screens (FR-HH-1 to FR-HH-3, D32, D33): read-only, one call each. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("households", e);
    return toPublicError(e);
  }
}

type DbHouseholdRow = {
  household_id: string;
  name: string;
  created_at: string;
  primary_manager_id: string | null;
  primary_manager_name: string | null;
  managers: number;
  helpers_active: number;
  last_activity_at: string | null;
  tasks_scheduled_7d: number;
  tasks_done_7d: number;
};

export function toHouseholdRow(r: DbHouseholdRow): HouseholdRow {
  return {
    householdId: r.household_id,
    name: r.name,
    createdAt: r.created_at,
    primaryManagerId: r.primary_manager_id,
    primaryManagerName: r.primary_manager_name,
    managers: r.managers,
    helpersActive: r.helpers_active,
    lastActivityAt: r.last_activity_at,
    tasksScheduled7d: r.tasks_scheduled_7d,
    tasksDone7d: r.tasks_done_7d,
  };
}

type DbHouseholdDetail = {
  household_id: string;
  name: string;
  created_at: string;
  timezone: string | null;
  managers: { user_id: string; full_name: string; role: UserKind }[];
  helpers: {
    helper_id: string;
    user_id: string | null;
    name: string;
    station: string | null;
    employment: Employment | null;
    status: HelperStatus;
    started_on: string | null;
    ended_on: string | null;
    shared: boolean;
  }[];
  tasks_scheduled_7d: number;
  tasks_done_7d: number;
  tasks_done_30d: number;
  last_activity_at: string | null;
};

export function toHouseholdDetail(d: DbHouseholdDetail): HouseholdDetail {
  return {
    householdId: d.household_id,
    name: d.name,
    createdAt: d.created_at,
    timezone: d.timezone,
    managers: d.managers.map((m) => ({ userId: m.user_id, fullName: m.full_name, role: m.role })),
    helpers: d.helpers.map((h) => ({
      helperId: h.helper_id,
      userId: h.user_id,
      name: h.name,
      station: h.station,
      employment: h.employment,
      status: h.status,
      startedOn: h.started_on,
      endedOn: h.ended_on,
      shared: h.shared,
    })),
    tasksScheduled7d: d.tasks_scheduled_7d,
    tasksDone7d: d.tasks_done_7d,
    tasksDone30d: d.tasks_done_30d,
    lastActivityAt: d.last_activity_at,
  };
}

export type ListHouseholdsInput = { page: number; search?: string };

export function listHouseholdsHandler(
  input: ListHouseholdsInput,
): Promise<{ ok: true; households: HouseholdRow[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    const page = parsePage(input.page);
    const search = parseSearch(input.search);
    await requireStaff("households.view");

    const { data, error } = await getAdminClient().rpc("staff_list_households", {
      p_search: search,
      ...pageWindow(page),
      p_now: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DbHouseholdRow[];
    return {
      ok: true as const,
      hasMore: rows.length > PAGE_SIZE,
      households: rows.slice(0, PAGE_SIZE).map(toHouseholdRow),
    };
  });
}

const NOT_FOUND = "There's no household with this address.";

export function getHouseholdHandler(input: {
  householdId: string;
}): Promise<{ ok: true; household: HouseholdDetail } | PublicError> {
  return run(async () => {
    if (!isUuid(input.householdId)) throw new ConsoleError("not_found", NOT_FOUND);
    await requireStaff("households.view");

    const { data, error } = await getAdminClient().rpc("staff_get_household", {
      p_household_id: input.householdId,
      p_now: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    if (!data) throw new ConsoleError("not_found", NOT_FOUND);
    return { ok: true as const, household: toHouseholdDetail(data as DbHouseholdDetail) };
  });
}
