import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid, PAGE_SIZE, pageWindow, parsePage } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import type { DeletionCounts, DeletionResult, DeletionRow, DeletionView } from "./deletions.types";

/** Deletion requests (§5.5, D36): one function call each after the guard. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("deletions", e);
    return toPublicError(e);
  }
}

type DbDeletionRow = {
  request_id: string;
  user_id: string;
  full_name: string | null;
  user_type: string | null;
  status: DeletionRow["status"];
  requested_at: string;
  due_at: string;
  days_left: number;
  processed_at: string | null;
  blockers: DeletionRow["blockers"] | null;
};

export function toDeletionRow(r: DbDeletionRow): DeletionRow {
  return {
    requestId: r.request_id,
    userId: r.user_id,
    fullName: r.full_name,
    userType: r.user_type,
    status: r.status,
    requestedAt: r.requested_at,
    dueAt: r.due_at,
    daysLeft: r.days_left,
    processedAt: r.processed_at,
    blockers: r.blockers ?? [],
  };
}

export function listDeletionsHandler(input: {
  view: DeletionView;
  page: number;
}): Promise<{ ok: true; requests: DeletionRow[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    if (input.view !== "pending" && input.view !== "history") {
      throw new ConsoleError("invalid_input", "Pick pending or history.");
    }
    const page = parsePage(input.page);
    await requireStaff("deletions.view");
    const { data, error } = await getAdminClient().rpc("staff_list_deletion_requests", {
      p_view: input.view,
      ...pageWindow(page),
      p_now: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DbDeletionRow[];
    return {
      ok: true as const,
      hasMore: rows.length > PAGE_SIZE,
      requests: rows.slice(0, PAGE_SIZE).map(toDeletionRow),
    };
  });
}

export function deletionCountsHandler(): Promise<
  { ok: true; counts: DeletionCounts } | PublicError
> {
  return run(async () => {
    await requireStaff("deletions.view");
    const { data, error } = await getAdminClient().rpc("staff_deletion_counts", {
      p_now: new Date().toISOString(),
    });
    if (error || !data) throw new Error(error?.message ?? "staff_deletion_counts returned nothing");
    const d = data as { pending: number; due_soon: number; overdue: number };
    return {
      ok: true as const,
      counts: { pending: d.pending, dueSoon: d.due_soon, overdue: d.overdue },
    };
  });
}

/**
 * Processes one request after the two-step code (FR-DL-3, S-5). LINARA's own
 * refusal comes back as it is (FR-DL-4); nothing changes when it refuses.
 */
export function processDeletionHandler(input: {
  requestId: string;
  code: string;
}): Promise<{ ok: true; result: DeletionResult } | PublicError> {
  return run(async () => {
    if (!isUuid(input.requestId)) {
      throw new ConsoleError("not_found", "That request doesn't exist.");
    }
    const staff = await requireStaff("deletions.process");
    await requireFreshCode(staff, input.code);
    const { data, error } = await getAdminClient().rpc("staff_process_deletion", {
      p_actor: staff.userId,
      p_request_id: input.requestId,
    });
    if (error) {
      if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
      throw new Error(`staff_process_deletion: ${error.message}`);
    }
    return { ok: true as const, result: (data ?? {}) as DeletionResult };
  });
}
