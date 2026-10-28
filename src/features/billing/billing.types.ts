import type { CatalogState, Cycle } from "@/features/plans/plans.types";

/**
 * Billing preview (D40, D47). Sample data only: Linara has no billing tables
 * yet (D3, §14), so nothing here is read from or written to a database.
 * Subscriptions use the plan catalog from the Plans screen. Money is whole
 * centavos.
 */
export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PaymentChannel = "GCASH" | "MAYA" | "CARD" | "QRPH" | "OTHER";
export type PaymentMethod = { channel: PaymentChannel; ending: string };

export type SubscriptionAddon = { addonId: string; quantity: number };

export type Subscription = {
  id: string;
  householdId: string;
  householdName: string;
  /** The household's manager who pays. Helpers never pay. */
  payerName: string;
  planId: string;
  /** The plan version it joined on; a later version doesn't change it. */
  planVersion: number;
  cycle: Cycle;
  addons: SubscriptionAddon[];
  /** Centavos charged each cycle, plan and add-ons together, fixed when it was set. */
  amount: number;
  status: SubscriptionStatus;
  startedAt: string;
  /** When the current paid or trial period ends. Null when nothing renews. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  method: PaymentMethod | null;
};

export const PAYMENT_STATUSES = ["paid", "failed", "refunded", "pending"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type Payment = {
  id: string;
  subscriptionId: string;
  reference: string;
  /** Centavos. */
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: string;
  failureReason: string | null;
};

/** The screens' data read from the database (D48). */
export type LiveBilling = {
  state: CatalogState;
  /** Billing test tools are on here (dev and staging only). */
  testTools: boolean;
};
