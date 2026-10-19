import { planById } from "./billing.sample";
import type { BillingState, PlanId, Subscription } from "./billing.types";

/** What the preview's buttons do to the on-screen sample (D40). Nothing is charged. */
export type BillingAction =
  | { type: "change_plan"; subscriptionId: string; planId: PlanId }
  | { type: "cancel_at_period_end"; subscriptionId: string }
  | { type: "resume"; subscriptionId: string }
  | { type: "retry_payment"; paymentId: string }
  | { type: "refund_payment"; paymentId: string };

function addInterval(from: Date, interval: "month" | "year"): string {
  const d = new Date(from);
  if (interval === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

function updateSub(
  state: BillingState,
  id: string,
  change: (s: Subscription) => Subscription,
): BillingState {
  return { ...state, subscriptions: state.subscriptions.map((s) => (s.id === id ? change(s) : s)) };
}

export function billingReducer(
  state: BillingState,
  action: BillingAction,
  now: Date = new Date(),
): BillingState {
  switch (action.type) {
    case "change_plan": {
      const sub = state.subscriptions.find((s) => s.id === action.subscriptionId);
      if (!sub || sub.planId === action.planId) return state;
      const plan = planById(action.planId);
      const method = sub.method ?? { channel: "GCASH" as const, ending: "0000" };
      const next = updateSub(state, sub.id, (s) => ({
        ...s,
        planId: plan.id,
        status: "active",
        cancelAtPeriodEnd: false,
        periodEnd: plan.interval ? addInterval(now, plan.interval) : null,
        method: plan.price > 0 ? method : s.method,
      }));
      if (plan.price === 0) return next;
      return {
        ...next,
        payments: [
          {
            id: `pay-new-${state.payments.length + 1}`,
            subscriptionId: sub.id,
            reference: `SAMPLE-${2000 + state.payments.length}`,
            amount: plan.price,
            status: "paid",
            method,
            createdAt: now.toISOString(),
            failureReason: null,
          },
          ...next.payments,
        ],
      };
    }
    case "cancel_at_period_end":
      return updateSub(state, action.subscriptionId, (s) =>
        s.status === "cancelled" || s.planId === "free" ? s : { ...s, cancelAtPeriodEnd: true },
      );
    case "resume":
      return updateSub(state, action.subscriptionId, (s) => ({ ...s, cancelAtPeriodEnd: false }));
    case "retry_payment": {
      const payment = state.payments.find((p) => p.id === action.paymentId);
      if (!payment || payment.status !== "failed") return state;
      const paid: BillingState = {
        ...state,
        payments: state.payments.map((p) =>
          p.id === payment.id ? { ...p, status: "paid", failureReason: null } : p,
        ),
      };
      return updateSub(paid, payment.subscriptionId, (s) => {
        if (s.status !== "past_due") return s;
        const interval = planById(s.planId).interval;
        return { ...s, status: "active", periodEnd: interval ? addInterval(now, interval) : null };
      });
    }
    case "refund_payment":
      return {
        ...state,
        payments: state.payments.map((p) =>
          p.id === action.paymentId && p.status === "paid" ? { ...p, status: "refunded" } : p,
        ),
      };
  }
}

export type BillingSummary = {
  active: number;
  trialing: number;
  pastDue: number;
  ending: number;
  /** Pesos a month from paying subscriptions (yearly plans counted as a twelfth). */
  monthlyRecurring: number;
};

export function summarize(state: BillingState): BillingSummary {
  const subs = state.subscriptions;
  const monthlyRecurring = subs
    .filter((s) => s.status === "active" || s.status === "past_due")
    .reduce((sum, s) => {
      const plan = planById(s.planId);
      return sum + (plan.interval === "year" ? plan.price / 12 : plan.price);
    }, 0);
  return {
    active: subs.filter((s) => s.status === "active").length,
    trialing: subs.filter((s) => s.status === "trialing").length,
    pastDue: subs.filter((s) => s.status === "past_due").length,
    ending: subs.filter((s) => s.cancelAtPeriodEnd && s.status !== "cancelled").length,
    monthlyRecurring: Math.round(monthlyRecurring),
  };
}
