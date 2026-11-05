import { currentVersion } from "@/features/plans/plans.logic";
export { householdsOn } from "@/features/plans/plans.logic";
import type { Addon, CatalogState, Cycle, Plan } from "@/features/plans/plans.types";

import type { Subscription, SubscriptionAddon } from "./billing.types";

/**
 * What the preview's buttons do to the on-screen sample (D40, D47). Nothing is
 * charged. Prices come from the plan catalog the Plans screen edits.
 */
export type BillingAction =
  | {
      type: "change_plan";
      subscriptionId: string;
      planId: string;
      cycle: Cycle;
      addons: SubscriptionAddon[];
    }
  | { type: "cancel_at_period_end"; subscriptionId: string }
  | { type: "resume"; subscriptionId: string }
  | { type: "retry_payment"; paymentId: string }
  | { type: "refund_payment"; paymentId: string };

export type BillingResult = { ok: true; state: CatalogState } | { ok: false; message: string };

export const MAX_ADDON_QUANTITY = 10;

const fail = (message: string): BillingResult => ({ ok: false, message });

/** How many months a cycle covers, for add-ons (priced a month) and the monthly figure. */
const MONTHS: Record<Cycle, number | null> = { monthly: 1, annual: 12, one_time: null };

function addPeriod(from: Date, cycle: Cycle): string | null {
  const months = MONTHS[cycle];
  if (months === null) return null;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/** Plans a household can move to: published, in the order households see them. */
export function offeredPlans(state: CatalogState): Plan[] {
  return state.plans
    .filter((p) => p.status === "published")
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** The cycles a plan is sold on, in the usual order. */
export function pricedCycles(plan: Plan): Cycle[] {
  return (["monthly", "annual", "one_time"] as const).filter(
    (c) => plan.content.prices[c] !== null,
  );
}

export type Quote = { ok: true; amount: number } | { ok: false; message: string };

/**
 * What a household would pay each cycle for a plan, cycle and add-ons, or why
 * it can't have them. Add-ons are priced a month, so a year is twelve.
 */
export function quote(
  state: CatalogState,
  planId: string,
  cycle: Cycle,
  addons: SubscriptionAddon[],
): Quote {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return { ok: false, message: "That plan isn't in the catalog." };
  if (plan.status !== "published") return { ok: false, message: "That plan isn't offered now." };
  const price = plan.content.prices[cycle];
  if (price === null) return { ok: false, message: "That plan isn't sold that way." };
  let amount = price;
  const seen = new Set<string>();
  for (const a of addons) {
    if (seen.has(a.addonId)) return { ok: false, message: "An add-on is listed twice." };
    seen.add(a.addonId);
    if (!Number.isInteger(a.quantity) || a.quantity < 0 || a.quantity > MAX_ADDON_QUANTITY) {
      return { ok: false, message: `Add 0 to ${MAX_ADDON_QUANTITY} of each add-on.` };
    }
    if (a.quantity === 0) continue;
    const addon = state.addons.find((x) => x.id === a.addonId);
    if (!addon || addon.status !== "active" || addon.monthlyPrice === null) {
      return { ok: false, message: "One of the add-ons isn't offered now." };
    }
    const months = MONTHS[cycle];
    if (months === null) return { ok: false, message: "Add-ons need a monthly or yearly plan." };
    amount += addon.monthlyPrice * months * a.quantity;
  }
  if (price === 0 && amount > 0) {
    return { ok: false, message: "Add-ons need a paid plan." };
  }
  return { ok: true, amount };
}

function updateSub(
  state: CatalogState,
  id: string,
  change: (s: Subscription) => Subscription,
): CatalogState {
  return { ...state, subscriptions: state.subscriptions.map((s) => (s.id === id ? change(s) : s)) };
}

export function billingReducer(
  state: CatalogState,
  action: BillingAction,
  now: Date = new Date(),
): BillingResult {
  switch (action.type) {
    case "change_plan": {
      const sub = state.subscriptions.find((s) => s.id === action.subscriptionId);
      if (!sub) return fail("This subscription isn't in the sample any more.");
      const addons = action.addons.filter((a) => a.quantity > 0);
      const q = quote(state, action.planId, action.cycle, addons);
      if (!q.ok) return fail(q.message);
      const plan = state.plans.find((p) => p.id === action.planId) as Plan;
      const same =
        sub.status !== "cancelled" &&
        sub.planId === plan.id &&
        sub.cycle === action.cycle &&
        sub.planVersion === currentVersion(plan) &&
        JSON.stringify(sub.addons) === JSON.stringify(addons);
      if (same) return fail("That's the plan it already has.");
      const method = sub.method ?? { channel: "GCASH" as const, ending: "0000" };
      const next = updateSub(state, sub.id, (s) => ({
        ...s,
        planId: plan.id,
        planVersion: currentVersion(plan),
        cycle: action.cycle,
        addons,
        amount: q.amount,
        status: "active",
        cancelAtPeriodEnd: false,
        periodEnd: q.amount > 0 ? addPeriod(now, action.cycle) : null,
        method: q.amount > 0 ? method : s.method,
      }));
      if (q.amount === 0) return { ok: true, state: next };
      return {
        ok: true,
        state: {
          ...next,
          payments: [
            {
              id: `pay-new-${state.payments.length + 1}`,
              subscriptionId: sub.id,
              reference: `SAMPLE-${2000 + state.payments.length}`,
              amount: q.amount,
              status: "paid",
              method,
              createdAt: now.toISOString(),
              failureReason: null,
            },
            ...next.payments,
          ],
        },
      };
    }
    case "cancel_at_period_end": {
      const sub = state.subscriptions.find((s) => s.id === action.subscriptionId);
      if (!sub) return fail("This subscription isn't in the sample any more.");
      if (sub.status === "cancelled") return fail("It's already cancelled.");
      if (sub.amount === 0 || sub.periodEnd === null)
        return fail("Nothing renews, so there's nothing to cancel.");
      if (sub.cancelAtPeriodEnd) return fail("It's already set to end.");
      return {
        ok: true,
        state: updateSub(state, sub.id, (s) => ({ ...s, cancelAtPeriodEnd: true })),
      };
    }
    case "resume": {
      const sub = state.subscriptions.find((s) => s.id === action.subscriptionId);
      if (!sub) return fail("This subscription isn't in the sample any more.");
      if (!sub.cancelAtPeriodEnd || sub.status === "cancelled") return fail("It isn't set to end.");
      return {
        ok: true,
        state: updateSub(state, sub.id, (s) => ({ ...s, cancelAtPeriodEnd: false })),
      };
    }
    case "retry_payment": {
      const payment = state.payments.find((p) => p.id === action.paymentId);
      if (!payment || payment.status !== "failed")
        return fail("Only a failed payment can be retried.");
      const paid: CatalogState = {
        ...state,
        payments: state.payments.map((p) =>
          p.id === payment.id ? { ...p, status: "paid", failureReason: null } : p,
        ),
      };
      return {
        ok: true,
        state: updateSub(paid, payment.subscriptionId, (s) =>
          s.status !== "past_due"
            ? s
            : { ...s, status: "active", periodEnd: addPeriod(now, s.cycle) },
        ),
      };
    }
    case "refund_payment": {
      const payment = state.payments.find((p) => p.id === action.paymentId);
      if (!payment || payment.status !== "paid" || payment.amount <= 0) {
        return fail("Only a paid payment can be refunded.");
      }
      return {
        ok: true,
        state: {
          ...state,
          payments: state.payments.map((p) =>
            p.id === payment.id ? { ...p, status: "refunded" } : p,
          ),
        },
      };
    }
  }
}

/** "Normal, monthly" or "Premium, yearly". */
export function planLabel(state: CatalogState, sub: Subscription): string {
  const name = state.plans.find((p) => p.id === sub.planId)?.content.name ?? "Unknown plan";
  const cycle = { monthly: "monthly", annual: "yearly", one_time: "one-time" }[sub.cycle];
  return sub.amount === 0 ? name : `${name}, ${cycle}`;
}

/** "+1 kasambahay, +2 households", or "" with none. */
export function addonsLabel(addons: Addon[], items: SubscriptionAddon[]): string {
  return items
    .filter((i) => i.quantity > 0)
    .map((i) => {
      const a = addons.find((x) => x.id === i.addonId);
      return a ? `${a.name} × ${i.quantity}` : null;
    })
    .filter(Boolean)
    .join(", ");
}

export type BillingSummary = {
  active: number;
  trialing: number;
  pastDue: number;
  ending: number;
  /** Centavos a month from paying subscriptions (yearly as a twelfth, one-time not at all). */
  monthlyRecurring: number;
};

export function summarize(state: CatalogState): BillingSummary {
  const subs = state.subscriptions;
  const monthlyRecurring = subs
    .filter((s) => s.status === "active" || s.status === "past_due")
    .reduce((sum, s) => {
      const months = MONTHS[s.cycle];
      return months === null ? sum : sum + s.amount / months;
    }, 0);
  return {
    active: subs.filter((s) => s.status === "active").length,
    trialing: subs.filter((s) => s.status === "trialing").length,
    pastDue: subs.filter((s) => s.status === "past_due").length,
    ending: subs.filter((s) => s.cancelAtPeriodEnd && s.status !== "cancelled").length,
    monthlyRecurring: Math.round(monthlyRecurring),
  };
}
