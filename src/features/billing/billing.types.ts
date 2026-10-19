/**
 * Billing preview (D40). Sample data only: Linara has no billing tables yet
 * (D3, §14), so nothing here is read from or written to a database.
 */
export type PlanId = "free" | "premium_monthly" | "premium_yearly";

export type Plan = {
  id: PlanId;
  name: string;
  /** Pesos per interval. Placeholder prices until billing is planned. */
  price: number;
  interval: "month" | "year" | null;
  includes: string[];
};

export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PaymentChannel = "GCASH" | "MAYA" | "CARD";
export type PaymentMethod = { channel: PaymentChannel; ending: string };

export type Subscription = {
  id: string;
  householdId: string;
  householdName: string;
  /** The household's manager who pays. Helpers never pay. */
  payerName: string;
  planId: PlanId;
  status: SubscriptionStatus;
  startedAt: string;
  /** When the current paid or trial period ends. Null on Free. */
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
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: string;
  failureReason: string | null;
};

export type BillingState = { subscriptions: Subscription[]; payments: Payment[] };
