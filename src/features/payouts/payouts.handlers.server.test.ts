import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import { listPayoutProblemsHandler, payoutCountsHandler } from "./payouts.handlers.server";

const NOW = new Date("2026-10-16T12:00:00Z");
const dbRow = (i: number) => ({
  attempt_id: `a${i}`,
  payslip_id: `p${i}`,
  attempt_number: 1,
  kind: "failed",
  failure_reason: "Account closed",
  reference_id: `ref-${i}`,
  channel_code: "PH_GCASH",
  helper_id: `h${i}`,
  helper_name: "Nena",
  household_id: "hh1",
  household_name: "Reyes home",
  cutoff_start: "2026-10-01",
  cutoff_end: "2026-10-15",
  created_at: "2026-10-16T09:00:00Z",
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.useRealTimers());

describe("payout problems (FR-PO-1, D38)", () => {
  it("list checks payouts.view first and pages", async () => {
    m.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => dbRow(i)), error: null });
    const res = await listPayoutProblemsHandler({ page: 1 });
    expect(m.requireStaff).toHaveBeenCalledWith("payouts.view");
    expect(m.rpc).toHaveBeenCalledWith("staff_list_payout_problems", {
      p_now: NOW.toISOString(),
      p_kind: null,
      p_limit: 51,
      p_offset: 50,
    });
    if (!res.ok) throw new Error("expected ok");
    expect(res.hasMore).toBe(true);
    expect(res.problems).toHaveLength(50);
    expect(res.problems[0]).toEqual({
      attemptId: "a0",
      payslipId: "p0",
      attemptNumber: 1,
      kind: "failed",
      failureReason: "Account closed",
      referenceId: "ref-0",
      channelCode: "PH_GCASH",
      helperId: "h0",
      helperName: "Nena",
      householdId: "hh1",
      householdName: "Reyes home",
      cutoffStart: "2026-10-01",
      cutoffEnd: "2026-10-15",
      createdAt: "2026-10-16T09:00:00Z",
    });
  });

  it("passes the kind filter", async () => {
    await listPayoutProblemsHandler({ page: 0, kind: "no_answer" });
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_kind: "no_answer", p_offset: 0 });
  });

  it("an unknown kind is refused", async () => {
    const res = await listPayoutProblemsHandler({ page: 0, kind: "succeeded" as never });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a refused permission stops before the database", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    const res = await listPayoutProblemsHandler({ page: 0 });
    expect(res).toMatchObject({ ok: false, code: "not_allowed" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("other errors say nothing", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret detail" } });
    const res = await listPayoutProblemsHandler({ page: 0 });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("secret detail");
  });

  it("counts check payouts.view and use the server's clock", async () => {
    const counts = { failed: 1, cancelled: 0, unclear: 2, stuck: 0, no_answer: 3 };
    m.rpc.mockResolvedValue({ data: counts, error: null });
    const res = await payoutCountsHandler();
    expect(m.requireStaff).toHaveBeenCalledWith("payouts.view");
    expect(m.rpc).toHaveBeenCalledWith("staff_payout_counts", { p_now: NOW.toISOString() });
    expect(res).toEqual({ ok: true, counts });
  });
});
