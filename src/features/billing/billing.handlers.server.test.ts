import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn(), requireFreshCode: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/features/auth/reauth.server", () => ({
  requireFreshCode: (...a: unknown[]) => m.requireFreshCode(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/log.server", () => ({ logError: vi.fn() }));

import { ConsoleError } from "@/lib/console-error";
import { SAMPLE_CATALOG } from "@/features/plans/plans.sample";

import {
  billingActionHandler,
  catalogActionHandler,
  loadBillingHandler,
  testShiftHandler,
  toState,
} from "./billing.handlers.server";

const STAFF = { userId: "00000000-0000-0000-0000-000000000901" };
const MANAGER = "00000000-0000-0000-0000-000000000001";

const dbState = (over: Record<string, unknown> = {}) => ({
  plans: SAMPLE_CATALOG.plans,
  addons: SAMPLE_CATALOG.addons,
  switches: [
    { key: "staff_pay_hr", enabled: false, updatedAt: "2026-10-26T04:00:00Z", updatedBy: "" },
    { key: "billing_test_tools", enabled: true, updatedAt: "2026-10-26T04:00:00Z", updatedBy: "" },
  ],
  switchHistory: [],
  subscriptions: [],
  payments: [],
  testTools: false,
  ...over,
});

const calls = () => m.rpc.mock.calls.map((c) => c[0]);

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue(STAFF);
  m.requireFreshCode.mockReset().mockResolvedValue(undefined);
  m.rpc
    .mockReset()
    .mockImplementation(async (fn: string) =>
      fn === "staff_billing_state" ? { data: dbState(), error: null } : { data: null, error: null },
    );
});

describe("reading", () => {
  it("needs billing.view", async () => {
    await loadBillingHandler();
    expect(m.requireStaff).toHaveBeenCalledWith("billing.view");
  });

  it("signed out or without the permission: nothing is read", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed", "No."));
    expect(await loadBillingHandler()).toMatchObject({ ok: false, code: "not_allowed" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps what the database says onto the screens", () => {
    const { state } = toState(
      dbState({
        subscriptions: [
          { id: MANAGER, status: "restricted", method: "PAYMAYA", planId: "normal", addons: [] },
        ],
        payments: [
          {
            id: "p1",
            status: "expired",
            channel: "GCASH",
            failureReason: "The page expired.",
            amount: 19900,
          },
          {
            id: "p2",
            status: "review",
            channel: "CREDIT_CARD",
            failureReason: null,
            amount: 19900,
          },
        ],
      }) as never,
    );
    expect(state.subscriptions[0]).toMatchObject({
      status: "past_due",
      method: { channel: "MAYA" },
    });
    expect(state.payments.map((p) => [p.status, p.method.channel])).toEqual([
      ["failed", "GCASH"],
      ["pending", "CARD"],
    ]);
    expect(state.payments[1].failureReason).toMatch(/needs checking/);
    // Switches the console can't describe (the test tools) aren't listed as global switches.
    expect(state.switches.map((s) => s.key)).toEqual(["staff_pay_hr"]);
  });
});

describe("changing the catalog", () => {
  it("needs billing.manage, and is checked with the screen's rules against the database first", async () => {
    const res = await catalogActionHandler({
      action: { type: "create_plan", id: "free", name: "Free" },
    });
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(res).toMatchObject({ ok: false, message: "A plan with this id already exists." });
    expect(calls()).toEqual(["staff_billing_state"]);
  });

  it("a valid change is written by its own SQL function, by the signed-in admin", async () => {
    await catalogActionHandler({
      action: { type: "set_status", planId: "premium", status: "hidden" },
    });
    const write = m.rpc.mock.calls.find((c) => c[0] === "staff_billing_set_status");
    expect(write?.[1]).toEqual({ p_actor: STAFF.userId, p_id: "premium", p_status: "hidden" });
  });

  it("a switch needs switches.manage, and turning one on a fresh two-step code", async () => {
    const off = await catalogActionHandler({
      action: { type: "set_switch", key: "staff_pay_hr", enabled: true, note: "Cleared" },
    });
    expect(m.requireStaff).toHaveBeenCalledWith("switches.manage");
    expect(off).toMatchObject({ ok: false, message: "Enter your two-step code." });
    expect(calls()).not.toContain("staff_set_switch");

    m.requireFreshCode.mockRejectedValueOnce(
      new ConsoleError("invalid_input", "That code didn't work."),
    );
    const wrong = await catalogActionHandler({
      action: { type: "set_switch", key: "staff_pay_hr", enabled: true, note: "Cleared" },
      code: "000000",
    });
    expect(wrong).toMatchObject({ ok: false });
    expect(calls()).not.toContain("staff_set_switch");

    await catalogActionHandler({
      action: { type: "set_switch", key: "staff_pay_hr", enabled: true, note: "Cleared" },
      code: "123456",
    });
    expect(m.requireFreshCode).toHaveBeenLastCalledWith(STAFF, "123456");
    expect(calls()).toContain("staff_set_switch");
  });

  it("a database refusal comes back as its own message; anything else says nothing about itself", async () => {
    m.rpc.mockImplementation(async (fn: string) =>
      fn === "staff_billing_state"
        ? { data: dbState(), error: null }
        : { data: null, error: { code: "P0001", message: "Free can't be retired." } },
    );
    expect(
      await catalogActionHandler({
        action: { type: "set_status", planId: "premium", status: "hidden" },
      }),
    ).toMatchObject({ ok: false, message: "Free can't be retired." });
    m.rpc.mockImplementation(async (fn: string) =>
      fn === "staff_billing_state"
        ? { data: dbState(), error: null }
        : { data: null, error: { code: "42501", message: "permission denied for function x" } },
    );
    const res = await catalogActionHandler({
      action: { type: "set_status", planId: "premium", status: "hidden" },
    });
    expect(JSON.stringify(res)).not.toMatch(/permission denied/);
  });

  it("a malformed request is refused before anything is read", async () => {
    expect(await catalogActionHandler({ action: null as never })).toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("subscriptions", () => {
  it("cancel needs billing.manage and a real subscription id", async () => {
    expect(
      await billingActionHandler({ type: "cancel_at_period_end", subscriptionId: "' OR 1=1 --" }),
    ).toMatchObject({ ok: false });
    expect(calls()).not.toContain("staff_billing_set_cancel");
    await billingActionHandler({ type: "cancel_at_period_end", subscriptionId: MANAGER });
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(m.rpc.mock.calls.find((c) => c[0] === "staff_billing_set_cancel")?.[1]).toEqual({
      p_actor: STAFF.userId,
      p_manager: MANAGER,
      p_cancel: true,
    });
  });

  it("retry and refund are refused: payments go through Xendit", async () => {
    for (const type of ["retry_payment", "refund_payment"] as const) {
      expect(await billingActionHandler({ type, paymentId: "p1" })).toMatchObject({
        ok: false,
        message: expect.stringMatching(/Xendit's dashboard/),
      });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("moving a renewal date takes whole days only", async () => {
    expect(await testShiftHandler({ subscriptionId: MANAGER, days: 1.5 })).toMatchObject({
      ok: false,
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
