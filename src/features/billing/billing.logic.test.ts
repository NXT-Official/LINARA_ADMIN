import { describe, expect, it } from "vitest";

import { billingReducer, summarize } from "./billing.logic";
import { SAMPLE_BILLING } from "./billing.sample";

const now = new Date("2026-10-19T04:00:00Z");
const sub = (state: typeof SAMPLE_BILLING, id: string) =>
  state.subscriptions.find((s) => s.id === id)!;
const pay = (state: typeof SAMPLE_BILLING, id: string) => state.payments.find((p) => p.id === id)!;

describe("billing preview (D40)", () => {
  it("summarises the sample", () => {
    // Monthly: sub-1, sub-3 (past due), sub-6 at 249; yearly sub-2, sub-8 at 2490 / 12.
    expect(summarize(SAMPLE_BILLING)).toEqual({
      active: 5,
      trialing: 1,
      pastDue: 1,
      ending: 1,
      monthlyRecurring: Math.round(249 * 3 + (2490 / 12) * 2),
    });
  });

  it("retrying a failed payment pays it and brings the subscription back", () => {
    const next = billingReducer(SAMPLE_BILLING, { type: "retry_payment", paymentId: "pay-4" }, now);
    expect(pay(next, "pay-4")).toMatchObject({ status: "paid", failureReason: null });
    expect(sub(next, "sub-3")).toMatchObject({
      status: "active",
      periodEnd: "2026-11-19T04:00:00.000Z",
    });
  });

  it("only refunds paid payments", () => {
    const next = billingReducer(SAMPLE_BILLING, { type: "refund_payment", paymentId: "pay-1" });
    expect(pay(next, "pay-1").status).toBe("refunded");
    const same = billingReducer(SAMPLE_BILLING, { type: "refund_payment", paymentId: "pay-4" });
    expect(pay(same, "pay-4").status).toBe("failed");
  });

  it("cancel at period end and resume flip the flag; Free can't be cancelled", () => {
    const ending = billingReducer(SAMPLE_BILLING, {
      type: "cancel_at_period_end",
      subscriptionId: "sub-1",
    });
    expect(sub(ending, "sub-1").cancelAtPeriodEnd).toBe(true);
    const kept = billingReducer(ending, { type: "resume", subscriptionId: "sub-1" });
    expect(sub(kept, "sub-1").cancelAtPeriodEnd).toBe(false);
    const free = billingReducer(SAMPLE_BILLING, {
      type: "cancel_at_period_end",
      subscriptionId: "sub-5",
    });
    expect(sub(free, "sub-5").cancelAtPeriodEnd).toBe(false);
  });

  it("changing to a paid plan starts a period and records a payment", () => {
    const next = billingReducer(
      SAMPLE_BILLING,
      { type: "change_plan", subscriptionId: "sub-5", planId: "premium_yearly" },
      now,
    );
    expect(sub(next, "sub-5")).toMatchObject({
      planId: "premium_yearly",
      status: "active",
      periodEnd: "2027-10-19T04:00:00.000Z",
    });
    expect(next.payments).toHaveLength(SAMPLE_BILLING.payments.length + 1);
    expect(next.payments[0]).toMatchObject({
      subscriptionId: "sub-5",
      amount: 2490,
      status: "paid",
    });
  });

  it("changing to Free records no payment and has no renewal", () => {
    const next = billingReducer(
      SAMPLE_BILLING,
      { type: "change_plan", subscriptionId: "sub-1", planId: "free" },
      now,
    );
    expect(sub(next, "sub-1")).toMatchObject({ planId: "free", periodEnd: null });
    expect(next.payments).toHaveLength(SAMPLE_BILLING.payments.length);
  });

  it("never changes the shared sample", () => {
    const before = JSON.stringify(SAMPLE_BILLING);
    billingReducer(SAMPLE_BILLING, { type: "retry_payment", paymentId: "pay-4" }, now);
    expect(JSON.stringify(SAMPLE_BILLING)).toBe(before);
  });
});
