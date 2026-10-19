import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import type { PlanInterval } from "@/features/plans/plans.types";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import {
  householdIdOf,
  parseGrantInput,
  parseMarkPaidInput,
  parseRevokeInput,
  type GrantInput,
  type MarkPaidInput,
  type RevokeInput,
} from "./billing.input";
import type {
  BillingEntitlements,
  BillingInvoice,
  BillingNote,
  BillingSubscription,
  GrantResult,
  HouseholdBilling,
  MarkPaidResult,
  RevokeResult,
} from "./billing.types";

/** A household's plan and billing, and the staff writes on it (billing.view / billing.manage). */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("billing", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    // The billing SQL (017) isn't applied yet: say it's on our side, not the admin's.
    if (/function .* does not exist/i.test(error.message)) {
      logError("billing", new Error(`${fn}: ${error.message}`));
      throw new ConsoleError("outside_service");
    }
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

type DbEntitlements = {
  source: BillingEntitlements["source"];
  subscription_id: string | null;
  plan_name: string | null;
  status: string | null;
  effective_status: BillingEntitlements["effectiveStatus"];
  helper_seats: number | null;
  manager_seats: number | null;
  period_end: string | null;
  days_left: number | null;
};

type DbSubscription = {
  id: string;
  plan_name: string;
  interval: PlanInterval;
  status: string;
  helper_seats: number | null;
  manager_seats: number | null;
  home_seats: number;
  amount_centavos: number | string;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  note: string | null;
  created_at: string;
  revoked: boolean;
};

type DbInvoice = {
  id: string;
  invoice_number: string;
  subscription_id: string;
  status: BillingInvoice["status"];
  amount_centavos: number | string;
  currency: string;
  period_start: string;
  period_end: string | null;
  paid_at: string | null;
  paid_channel: string | null;
  created_at: string;
};

type DbDetail = {
  entitlements: DbEntitlements;
  subscriptions: DbSubscription[] | null;
  invoices: DbInvoice[] | null;
  homes: { id: string; name: string }[] | null;
  usage: { helpers: number; managers: number };
  notes: { subscription_id: string; status: string; note: string | null }[] | null;
};

export function toHouseholdBilling(d: DbDetail): HouseholdBilling {
  const e = d.entitlements;
  const notes: BillingNote[] = [];
  for (const n of d.notes ?? []) {
    if (n.note && n.note.trim() !== "") {
      notes.push({ subscriptionId: n.subscription_id, status: n.status, note: n.note });
    }
  }
  return {
    entitlements: {
      source: e.source,
      subscriptionId: e.subscription_id,
      planName: e.plan_name,
      status: e.status,
      effectiveStatus: e.effective_status,
      helperSeats: e.helper_seats,
      managerSeats: e.manager_seats,
      periodEnd: e.period_end,
      daysLeft: e.days_left,
    },
    subscriptions: (d.subscriptions ?? []).map((s): BillingSubscription => ({
      id: s.id,
      planName: s.plan_name,
      interval: s.interval,
      status: s.status,
      helperSeats: s.helper_seats,
      managerSeats: s.manager_seats,
      homeSeats: s.home_seats,
      amountCentavos: Number(s.amount_centavos),
      currentPeriodStart: s.current_period_start,
      currentPeriodEnd: s.current_period_end,
      canceledAt: s.canceled_at,
      note: s.note,
      createdAt: s.created_at,
      revoked: s.revoked === true,
    })),
    invoices: (d.invoices ?? []).map((i): BillingInvoice => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      subscriptionId: i.subscription_id,
      status: i.status,
      amountCentavos: Number(i.amount_centavos),
      currency: i.currency,
      periodStart: i.period_start,
      periodEnd: i.period_end,
      paidAt: i.paid_at,
      paidChannel: i.paid_channel,
      createdAt: i.created_at,
    })),
    homes: d.homes ?? [],
    usage: d.usage,
    notes,
  };
}

export function getHouseholdBillingHandler(input: {
  householdId: string;
}): Promise<{ ok: true; billing: HouseholdBilling } | PublicError> {
  return run(async () => {
    const householdId = householdIdOf(input.householdId);
    const staff = await requireStaff("billing.view");
    const data = await call<DbDetail | null>("billing_household_detail", {
      p_actor: staff.userId,
      p_household_id: householdId,
      p_now: new Date().toISOString(),
    });
    if (!data) throw new Error("billing_household_detail returned nothing");
    return { ok: true as const, billing: toHouseholdBilling(data) };
  });
}

/** The end date runs to 11:59 pm that day in Manila (UTC+8). */
const endOfDayManila = (date: string) => `${date}T23:59:00+08:00`;

export function grantPlanHandler(input: GrantInput): Promise<GrantResult | PublicError> {
  return run(async () => {
    const g = parseGrantInput(input);
    const staff = await requireStaff("billing.manage");
    await requireFreshCode(staff, g.code);
    const res = await call<{ subscription_id: string; invoice_id: string }>("billing_grant", {
      p_actor: staff.userId,
      p_household_id: g.householdId,
      p_plan_id: g.planId,
      p_helper_seats: g.helperSeats,
      p_manager_seats: g.managerSeats,
      p_period_end: g.periodEnd === null ? null : endOfDayManila(g.periodEnd),
      p_note: g.note === "" ? null : g.note,
      p_reason: g.reason,
    });
    return { ok: true as const, subscriptionId: res.subscription_id, invoiceId: res.invoice_id };
  });
}

/** Ends a subscription for good (billing_revoke); the household drops to the free tier. */
export function revokeSubscriptionHandler(input: RevokeInput): Promise<RevokeResult | PublicError> {
  return run(async () => {
    const v = parseRevokeInput(input);
    const staff = await requireStaff("billing.manage");
    await requireFreshCode(staff, v.code);
    await call<null>("billing_revoke", {
      p_actor: staff.userId,
      p_subscription_id: v.subscriptionId,
      p_reason: v.reason,
    });
    return { ok: true as const };
  });
}

export function markInvoicePaidHandler(
  input: MarkPaidInput,
): Promise<MarkPaidResult | PublicError> {
  return run(async () => {
    const p = parseMarkPaidInput(input);
    const staff = await requireStaff("billing.manage");
    await requireFreshCode(staff, p.code);
    const res = await call<{ applied: boolean }>("billing_mark_paid", {
      p_actor: staff.userId,
      p_invoice_id: p.invoiceId,
      p_channel: p.channel,
      p_note: p.note === "" ? null : p.note,
      p_reason: p.reason,
    });
    return { ok: true as const, applied: res.applied === true };
  });
}
