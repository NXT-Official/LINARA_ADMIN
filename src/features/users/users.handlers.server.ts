import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid, PAGE_SIZE, pageWindow, parsePage, parseSearch } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import {
  USER_KINDS,
  type Employment,
  type HelperStatus,
  type UserDetail,
  type UserKind,
  type UserRow,
} from "./users.types";

/** The Users screens (FR-US-1 to FR-US-3, D33): one function call each. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("users", e);
    return toPublicError(e);
  }
}

type DbUserRow = {
  user_id: string;
  full_name: string;
  email: string;
  user_type: UserKind;
  household_id: string | null;
  household_name: string | null;
  household_count: number;
  joined_at: string;
  last_sign_in_at: string | null;
  suspended: boolean;
  devices: number;
};

export function toUserRow(r: DbUserRow): UserRow {
  return {
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    kind: r.user_type,
    householdId: r.household_id,
    householdName: r.household_name,
    householdCount: r.household_count,
    joinedAt: r.joined_at,
    lastSignInAt: r.last_sign_in_at,
    suspended: r.suspended,
    devices: r.devices,
  };
}

type DbUserDetail = Omit<DbUserRow, "household_id" | "household_name" | "household_count"> & {
  memberships: { household_id: string; household_name: string; role: UserKind }[];
  jobs: {
    helper_id: string;
    household_id: string;
    household_name: string;
    station: string | null;
    employment: Employment | null;
    status: HelperStatus;
    started_on: string | null;
    ended_on: string | null;
    also_works_in: { household_id: string; household_name: string }[];
  }[];
  deletion: { id: string; requested_at: string } | null;
};

export function toUserDetail(d: DbUserDetail): UserDetail {
  return {
    userId: d.user_id,
    fullName: d.full_name,
    email: d.email,
    kind: d.user_type,
    joinedAt: d.joined_at,
    lastSignInAt: d.last_sign_in_at,
    suspended: d.suspended,
    devices: d.devices,
    memberships: d.memberships.map((m) => ({
      householdId: m.household_id,
      householdName: m.household_name,
      role: m.role,
    })),
    jobs: d.jobs.map((j) => ({
      helperId: j.helper_id,
      householdId: j.household_id,
      householdName: j.household_name,
      station: j.station,
      employment: j.employment,
      status: j.status,
      startedOn: j.started_on,
      endedOn: j.ended_on,
      alsoWorksIn: j.also_works_in.map((h) => ({
        householdId: h.household_id,
        householdName: h.household_name,
      })),
    })),
    deletion: d.deletion ? { id: d.deletion.id, requestedAt: d.deletion.requested_at } : null,
  };
}

export type ListUsersInput = {
  page: number;
  search?: string;
  kind?: UserKind;
  /** true: only suspended; false: only not suspended (FR-US-4). */
  suspended?: boolean;
};

export function listUsersHandler(
  input: ListUsersInput,
): Promise<{ ok: true; users: UserRow[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    const page = parsePage(input.page);
    const search = parseSearch(input.search);
    if (input.kind !== undefined && !USER_KINDS.includes(input.kind)) {
      throw new ConsoleError("invalid_input", "Pick a kind from the list.");
    }
    await requireStaff("users.view");

    const { data, error } = await getAdminClient().rpc("staff_find_users", {
      p_search: search,
      p_kind: input.kind ?? null,
      p_suspended: typeof input.suspended === "boolean" ? input.suspended : null,
      ...pageWindow(page),
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DbUserRow[];
    return {
      ok: true as const,
      hasMore: rows.length > PAGE_SIZE,
      users: rows.slice(0, PAGE_SIZE).map(toUserRow),
    };
  });
}

export function getUserHandler(input: {
  userId: string;
}): Promise<{ ok: true; user: UserDetail } | PublicError> {
  return run(async () => {
    if (!isUuid(input.userId))
      throw new ConsoleError("not_found", "There's no user with this address.");
    await requireStaff("users.view");

    const { data, error } = await getAdminClient().rpc("staff_get_user", {
      p_user_id: input.userId,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new ConsoleError("not_found", "There's no user with this address.");
    return { ok: true as const, user: toUserDetail(data as DbUserDetail) };
  });
}
