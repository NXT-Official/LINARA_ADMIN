import type { Payment, Subscription } from "@/features/billing/billing.types";

/**
 * Plans and switches preview (D47). Sample data only: nothing here is read
 * from or written to a database. Money is whole centavos so a price never
 * picks up a floating-point remainder.
 */
export const CYCLES = ["monthly", "annual", "one_time"] as const;
export type Cycle = (typeof CYCLES)[number];

export const PLAN_STATUSES = ["draft", "published", "hidden", "retired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const LIMIT_KEYS = ["households", "kasambahay", "co_managers"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export type SwitchKey = "staff_pay_hr";

export type FeatureKey =
  | "tasks"
  | "quick_utos"
  | "schedule"
  | "pantry"
  | "time_off"
  | "after_hours"
  | "teams_labels"
  | "remote_admin"
  | "work_record"
  | "staff_pay_hr";

/** A feature the apps can lock. The list is fixed in code: a new one needs code to gate it. */
export type Feature = {
  key: FeatureKey;
  name: string;
  description: string;
  /** The global switch that can turn it off for everyone, if any. */
  switchKey?: SwitchKey;
};

export type PlanContent = {
  name: string;
  description: string;
  /** Centavos per cycle; null when the plan isn't sold on that cycle. */
  prices: Record<Cycle, number | null>;
  trialDays: number;
  features: Record<FeatureKey, boolean>;
  /** null means unlimited. */
  limits: Record<LimitKey, number | null>;
};

export type PlanVersion = {
  version: number;
  savedAt: string;
  savedBy: string;
  /** What changed from the version before, in a few words. */
  summary: string;
};

export type Plan = {
  id: string;
  status: PlanStatus;
  displayOrder: number;
  content: PlanContent;
  /** Published versions, newest first. Empty while the plan has never been published. */
  versions: PlanVersion[];
  /** Sample prices standing in until marketing sets real ones. Cleared when a price is saved. */
  pricePlaceholder?: boolean;
};

export type Addon = {
  id: string;
  name: string;
  /** The limit it raises, and by how much per unit bought. */
  limitKey: LimitKey;
  step: number;
  /** Centavos a month; null until marketing sets it. */
  monthlyPrice: number | null;
  status: "active" | "hidden";
};

export type GlobalSwitch = {
  key: SwitchKey;
  name: string;
  description: string;
  /** What turns on or off with it, in the apps' words. */
  covers: string[];
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type SwitchChange = {
  id: string;
  key: SwitchKey;
  enabled: boolean;
  at: string;
  by: string;
  note: string;
};

/** The whole billing preview: the catalog and the households subscribed to it. */
export type CatalogState = {
  plans: Plan[];
  addons: Addon[];
  switches: GlobalSwitch[];
  switchHistory: SwitchChange[];
  subscriptions: Subscription[];
  payments: Payment[];
};
