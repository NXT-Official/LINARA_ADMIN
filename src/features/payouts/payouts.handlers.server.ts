import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { PAGE_SIZE, pageWindow, parsePage } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import {
  PAYOUT_KINDS,
  type PayoutCounts,
  type PayoutKind,
  type PayoutProblem,
} from "./payouts.types";

/** Payout problems (§5.7, D38): read only, one function call after the guard (D31). */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("payouts", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

type DbPayoutProblem = {
  attempt_id: string;
  payslip_id: string;
  attempt_number: number;
  kind: PayoutKind;
  failure_reason: string | null;
  reference_id: string;
  channel_code: string;
  helper_id: string;
  helper_name: string | null;
  household_id: string | null;
  household_name: string | null;
  cutoff_start: string;
  cutoff_end: string;
  created_at: string;
};

const toProblem = (r: DbPayoutProblem): PayoutProblem => ({
  attemptId: r.attempt_id,
  payslipId: r.payslip_id,
  attemptNumber: r.attempt_number,
  kind: r.kind,
  failureReason: r.failure_reason,
  referenceId: r.reference_id,
  channelCode: r.channel_code,
  helperId: r.helper_id,
  helperName: r.helper_name,
  householdId: r.household_id,
  householdName: r.household_name,
  cutoffStart: r.cutoff_start,
  cutoffEnd: r.cutoff_end,
  createdAt: r.created_at,
});

export type ListPayoutProblemsInput = { page?: number; kind?: PayoutKind };

export function listPayoutProblemsHandler(
  input: ListPayoutProblemsInput,
): Promise<{ ok: true; problems: PayoutProblem[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    const page = parsePage(input.page);
    if (input.kind !== undefined && !PAYOUT_KINDS.includes(input.kind)) {
      throw new ConsoleError("invalid_input", "Pick a kind of problem.");
    }
    await requireStaff("payouts.view");
    const rows = await call<DbPayoutProblem[]>("staff_list_payout_problems", {
      p_now: new Date().toISOString(),
      p_kind: input.kind ?? null,
      ...pageWindow(page),
    });
    return {
      ok: true as const,
      problems: (rows ?? []).slice(0, PAGE_SIZE).map(toProblem),
      hasMore: (rows ?? []).length > PAGE_SIZE,
    };
  });
}

export function payoutCountsHandler(): Promise<{ ok: true; counts: PayoutCounts } | PublicError> {
  return run(async () => {
    await requireStaff("payouts.view");
    const counts = await call<PayoutCounts>("staff_payout_counts", {
      p_now: new Date().toISOString(),
    });
    return { ok: true as const, counts };
  });
}
