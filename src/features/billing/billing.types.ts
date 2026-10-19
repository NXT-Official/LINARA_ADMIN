import type { PlanInterval } from "@/features/plans/plans.types";

export const INVOICE_CHANNELS = ["bank_transfer", "gcash", "maya", "cash", "other"] as const;
export type InvoiceChannel = (typeof INVOICE_CHANNELS)[number];

/** The most seats a grant gives per kind (billing_grant, 017); null is unlimited. */
export const MAX_SEATS = 1000;

export type EffectiveStatus = "active" | "trialing" | "past_due" | "expired" | "canceled";
export type EntitlementSource = "subscription" | "free" | "none";

/** What a household is entitled to right now. A null seat limit is unlimited. */
export type BillingEntitlements = {
  source: EntitlementSource;
  subscriptionId: string | null;
  planName: string | null;
  status: string | null;
  effectiveStatus: EffectiveStatus | null;
  helperSeats: number | null;
  managerSeats: number | null;
  periodEnd: string | null;
  daysLeft: number | null;
};

export type BillingSubscription = {
  id: string;
  planName: string;
  interval: PlanInterval;
  status: string;
  helperSeats: number | null;
  managerSeats: number | null;
  homeSeats: number;
  amountCentavos: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  note: string | null;
  createdAt: string;
  /** Ended for good by staff (billing_revoke): it can't be renewed, paid or revoked again. */
  revoked: boolean;
};

export type BillingInvoice = {
  id: string;
  invoiceNumber: string;
  subscriptionId: string;
  status: "pending" | "paid" | "expired" | "failed";
  amountCentavos: number;
  currency: string;
  periodStart: string;
  periodEnd: string | null;
  paidAt: string | null;
  paidChannel: string | null;
  createdAt: string;
};

export type BillingNote = { subscriptionId: string; status: string; note: string };

/** One household's plan and billing, as the console shows it (billing_household_detail). */
export type HouseholdBilling = {
  entitlements: BillingEntitlements;
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  homes: { id: string; name: string }[];
  usage: { helpers: number; managers: number };
  notes: BillingNote[];
};

export type GrantResult = { ok: true; subscriptionId: string; invoiceId: string };
export type MarkPaidResult = { ok: true; applied: boolean };
export type RevokeResult = { ok: true };
