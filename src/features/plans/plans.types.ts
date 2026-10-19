export const PLAN_INTERVALS = ["one_time", "monthly", "yearly"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];
export const PLAN_STATUSES = ["draft", "active", "archived"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/**
 * A plan as the console shows it. Money is integer centavos (PHP, tax-inclusive).
 * A null `included*` is unlimited; a null `extra*` is not sold.
 */
export type Plan = {
  id: string;
  name: string;
  tagline: string;
  inclusions: string[];
  interval: PlanInterval;
  baseCentavos: number;
  includedHelpers: number | null;
  includedManagers: number | null;
  includedHomes: number | null;
  extraHelperCentavos: number | null;
  extraManagerCentavos: number | null;
  extraHomeCentavos: number | null;
  trialDays: number;
  isPublic: boolean;
  status: PlanStatus;
  sortOrder: number;
};

/** What staff send to create (no id) or replace (with id) a plan; status has its own call. */
export type PlanInput = Omit<Plan, "id" | "status"> & { id?: string };

export type BillingSettings = {
  freeTierEnabled: boolean;
  freeHelperSeats: number | null;
  freeManagerSeats: number | null;
  supportEmail: string | null;
};

/** A `billing_plans` row as the staff functions return it. */
export type DbPlan = {
  id: string;
  name: string;
  tagline: string;
  inclusions: string[];
  interval: PlanInterval;
  base_centavos: number | string;
  included_helpers: number | null;
  included_managers: number | null;
  included_homes: number | null;
  extra_helper_centavos: number | string | null;
  extra_manager_centavos: number | string | null;
  extra_home_centavos: number | string | null;
  trial_days: number;
  is_public: boolean;
  status: PlanStatus;
  sort_order: number;
};

export type DbSettings = {
  free_tier_enabled: boolean;
  free_helper_seats: number | null;
  free_manager_seats: number | null;
  support_email: string | null;
};

const orNull = (n: number | string | null) => (n === null ? null : Number(n));

export function planFromDb(row: DbPlan): Plan {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    inclusions: row.inclusions,
    interval: row.interval,
    baseCentavos: Number(row.base_centavos),
    includedHelpers: row.included_helpers,
    includedManagers: row.included_managers,
    includedHomes: row.included_homes,
    extraHelperCentavos: orNull(row.extra_helper_centavos),
    extraManagerCentavos: orNull(row.extra_manager_centavos),
    extraHomeCentavos: orNull(row.extra_home_centavos),
    trialDays: row.trial_days,
    isPublic: row.is_public,
    status: row.status,
    sortOrder: row.sort_order,
  };
}

export function settingsFromDb(row: DbSettings): BillingSettings {
  return {
    freeTierEnabled: row.free_tier_enabled,
    freeHelperSeats: row.free_helper_seats,
    freeManagerSeats: row.free_manager_seats,
    supportEmail: row.support_email,
  };
}
