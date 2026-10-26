import { describe, expect, it } from "vitest";

import { applyAction, householdsOn } from "@/features/plans/plans.logic";
import { SAMPLE_CATALOG } from "@/features/plans/plans.sample";
import type { CatalogState } from "@/features/plans/plans.types";

import {
  addonsLabel,
  billingReducer,
  offeredPlans,
  planLabel,
  quote,
  summarize,
  type BillingAction,
  type BillingResult,
} from "./billing.logic";

const now = new Date("2026-10-19T04:00:00Z");
const run = (s: CatalogState, a: BillingAction) => billingReducer(s, a, now);
const ok = (res: BillingResult): CatalogState => {
  if (!res.ok) throw new Error(`refused: ${res.message}`);
  return res.state;
};
const refused = (res: BillingResult): string => {
  if (res.ok) throw new Error("expected a refusal");
  return res.message;
};
const sub = (s: CatalogState, id: string) => s.subscriptions.find((x) => x.id === id)!;
const pay = (s: CatalogState, id: string) => s.payments.find((x) => x.id === id)!;
const change = (
  subscriptionId: string,
  planId: string,
  cycle: "monthly" | "annual" | "one_time",
  addons: { addonId: string; quantity: number }[] = [],
): BillingAction => ({ type: "change_plan", subscriptionId, planId, cycle, addons });

describe("billing preview on the plan catalog (D40, D47)", () => {
  it("summarises the sample in centavos", () => {
    // Monthly: sub-1 24,900, sub-3 19,900 (past due), sub-6 19,900; yearly sub-2 399,000 and
    // sub-8 519,000 as twelfths. sub-4 is on trial and sub-7 cancelled, so neither counts.
    expect(summarize(SAMPLE_CATALOG)).toEqual({
      active: 5,
      trialing: 1,
      pastDue: 1,
      ending: 1,
      monthlyRecurring: Math.round(24_900 + 19_900 + 19_900 + 399_000 / 12 + 519_000 / 12),
    });
  });

  it("every sample amount matches its plan and add-ons at today's prices", () => {
    for (const s of SAMPLE_CATALOG.subscriptions) {
      expect(quote(SAMPLE_CATALOG, s.planId, s.cycle, s.addons), s.id).toEqual({
        ok: true,
        amount: s.amount,
      });
    }
  });

  it("counts households per plan from the subscriptions, leaving out cancelled ones", () => {
    expect(householdsOn(SAMPLE_CATALOG, "normal")).toBe(3);
    expect(householdsOn(SAMPLE_CATALOG, "premium")).toBe(3);
    expect(householdsOn(SAMPLE_CATALOG, "free")).toBe(1);
    expect(householdsOn(SAMPLE_CATALOG, "normal", 2)).toBe(0);
  });

  it("labels plans and add-ons", () => {
    expect(planLabel(SAMPLE_CATALOG, sub(SAMPLE_CATALOG, "sub-8"))).toBe("Premium, yearly");
    expect(planLabel(SAMPLE_CATALOG, sub(SAMPLE_CATALOG, "sub-5"))).toBe("Free");
    expect(addonsLabel(SAMPLE_CATALOG.addons, sub(SAMPLE_CATALOG, "sub-8").addons)).toBe(
      "Extra household × 1",
    );
  });
});

describe("quote", () => {
  it("prices add-ons a month, twelve on a yearly plan", () => {
    expect(
      quote(SAMPLE_CATALOG, "normal", "monthly", [{ addonId: "extra_kasambahay", quantity: 2 }]),
    ).toEqual({ ok: true, amount: 19_900 + 2 * 5_000 });
    expect(
      quote(SAMPLE_CATALOG, "normal", "annual", [{ addonId: "extra_kasambahay", quantity: 2 }]),
    ).toEqual({ ok: true, amount: 199_000 + 2 * 5_000 * 12 });
  });

  it("refuses what can't be sold", () => {
    const msg = (r: ReturnType<typeof quote>) => (r.ok ? "ok" : r.message);
    expect(msg(quote(SAMPLE_CATALOG, "gone", "monthly", []))).toMatch(/isn't in the catalog/);
    expect(msg(quote(SAMPLE_CATALOG, "normal", "one_time", []))).toMatch(/isn't sold that way/);
    expect(
      msg(quote(SAMPLE_CATALOG, "free", "monthly", [{ addonId: "extra_household", quantity: 1 }])),
    ).toMatch(/paid plan/);
    expect(
      msg(
        quote(SAMPLE_CATALOG, "normal", "monthly", [{ addonId: "extra_co_manager", quantity: 1 }]),
      ),
    ).toMatch(/isn't offered/);
    for (const quantity of [-1, 11, 1.5, Number.NaN]) {
      expect(
        quote(SAMPLE_CATALOG, "normal", "monthly", [{ addonId: "extra_household", quantity }]).ok,
      ).toBe(false);
    }
    expect(
      msg(
        quote(SAMPLE_CATALOG, "normal", "monthly", [
          { addonId: "extra_household", quantity: 1 },
          { addonId: "extra_household", quantity: 1 },
        ]),
      ),
    ).toMatch(/twice/);
  });

  it("won't sell a plan that isn't published", () => {
    const hidden = ok(
      applyAction(
        SAMPLE_CATALOG,
        { type: "set_status", planId: "premium", status: "hidden" },
        { now, by: "Tester" },
      ) as BillingResult,
    );
    expect(quote(hidden, "premium", "monthly", []).ok).toBe(false);
    expect(offeredPlans(hidden).map((p) => p.id)).toEqual(["free", "normal"]);
  });
});

describe("billingReducer", () => {
  it("changing to a paid plan with add-ons starts a period, takes the plan's version, and records the payment", () => {
    const next = ok(
      run(
        SAMPLE_CATALOG,
        change("sub-5", "normal", "annual", [{ addonId: "extra_household", quantity: 1 }]),
      ),
    );
    expect(sub(next, "sub-5")).toMatchObject({
      planId: "normal",
      planVersion: 1,
      cycle: "annual",
      amount: 199_000 + 10_000 * 12,
      status: "active",
      periodEnd: "2027-10-19T04:00:00.000Z",
    });
    expect(next.payments[0]).toMatchObject({
      subscriptionId: "sub-5",
      amount: 319_000,
      status: "paid",
    });
    expect(next.payments).toHaveLength(SAMPLE_CATALOG.payments.length + 1);
  });

  it("changing to Free records no payment and has no renewal", () => {
    const next = ok(run(SAMPLE_CATALOG, change("sub-1", "free", "monthly")));
    expect(sub(next, "sub-1")).toMatchObject({
      planId: "free",
      amount: 0,
      periodEnd: null,
      addons: [],
    });
    expect(next.payments).toHaveLength(SAMPLE_CATALOG.payments.length);
  });

  it("refuses a change to what it already has (a double submit)", () => {
    expect(
      refused(
        run(
          SAMPLE_CATALOG,
          change("sub-1", "normal", "monthly", [{ addonId: "extra_kasambahay", quantity: 1 }]),
        ),
      ),
    ).toMatch(/already has/);
  });

  it("a household on an older version keeps its price; a change moves it to the current one", () => {
    const repriced = ok(
      applyAction(
        SAMPLE_CATALOG,
        {
          type: "save_plan",
          planId: "normal",
          content: {
            ...SAMPLE_CATALOG.plans.find((p) => p.id === "normal")!.content,
            prices: { monthly: 24_900, annual: 249_000, one_time: null },
          },
        },
        { now, by: "Tester" },
      ) as BillingResult,
    );
    expect(sub(repriced, "sub-3")).toMatchObject({ planVersion: 1, amount: 19_900 });
    expect(householdsOn(repriced, "normal", 1)).toBe(3);
    const moved = ok(run(repriced, change("sub-3", "normal", "annual")));
    expect(sub(moved, "sub-3")).toMatchObject({ planVersion: 2, amount: 249_000 });
  });

  it("retrying a failed payment pays it and brings the subscription back for one cycle", () => {
    const next = ok(run(SAMPLE_CATALOG, { type: "retry_payment", paymentId: "pay-4" }));
    expect(pay(next, "pay-4")).toMatchObject({ status: "paid", failureReason: null });
    expect(sub(next, "sub-3")).toMatchObject({
      status: "active",
      periodEnd: "2026-11-19T04:00:00.000Z",
    });
    expect(refused(run(next, { type: "retry_payment", paymentId: "pay-4" }))).toMatch(/failed/);
  });

  it("refunds only a paid, non-zero payment, once", () => {
    const next = ok(run(SAMPLE_CATALOG, { type: "refund_payment", paymentId: "pay-1" }));
    expect(pay(next, "pay-1").status).toBe("refunded");
    expect(run(next, { type: "refund_payment", paymentId: "pay-1" }).ok).toBe(false);
    expect(run(SAMPLE_CATALOG, { type: "refund_payment", paymentId: "pay-4" }).ok).toBe(false);
    expect(run(SAMPLE_CATALOG, { type: "refund_payment", paymentId: "pay-9" }).ok).toBe(false);
  });

  it("cancel at period end and keep flip the flag; Free and cancelled can't be cancelled", () => {
    const ending = ok(
      run(SAMPLE_CATALOG, { type: "cancel_at_period_end", subscriptionId: "sub-1" }),
    );
    expect(sub(ending, "sub-1").cancelAtPeriodEnd).toBe(true);
    expect(run(ending, { type: "cancel_at_period_end", subscriptionId: "sub-1" }).ok).toBe(false);
    const kept = ok(run(ending, { type: "resume", subscriptionId: "sub-1" }));
    expect(sub(kept, "sub-1").cancelAtPeriodEnd).toBe(false);
    expect(run(SAMPLE_CATALOG, { type: "cancel_at_period_end", subscriptionId: "sub-5" }).ok).toBe(
      false,
    );
    expect(run(SAMPLE_CATALOG, { type: "cancel_at_period_end", subscriptionId: "sub-7" }).ok).toBe(
      false,
    );
    expect(run(SAMPLE_CATALOG, { type: "resume", subscriptionId: "sub-2" }).ok).toBe(false);
  });

  it("refuses unknown subscriptions and payments", () => {
    expect(run(SAMPLE_CATALOG, change("nope", "normal", "monthly")).ok).toBe(false);
    expect(run(SAMPLE_CATALOG, { type: "retry_payment", paymentId: "nope" }).ok).toBe(false);
  });

  it("never changes the shared sample", () => {
    const before = JSON.stringify(SAMPLE_CATALOG);
    run(SAMPLE_CATALOG, { type: "retry_payment", paymentId: "pay-4" });
    run(SAMPLE_CATALOG, change("sub-5", "premium", "monthly"));
    expect(JSON.stringify(SAMPLE_CATALOG)).toBe(before);
  });
});
