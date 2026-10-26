import { SAMPLE_PAYMENTS, SAMPLE_SUBSCRIPTIONS } from "@/features/billing/billing.sample";

import type { CatalogState, Feature, FeatureKey, LimitKey } from "./plans.types";

/** The features the apps can lock today, in the order the plan screen lists them. */
export const FEATURES: Feature[] = [
  { key: "tasks", name: "Tasks and the Board", description: "Daily tasks, routines and SOPs." },
  { key: "quick_utos", name: "Quick Utos", description: "Short instructions sent to staff." },
  { key: "schedule", name: "Schedule", description: "Shifts, appointments and availability." },
  { key: "pantry", name: "Pantry and groceries", description: "Stock, restocks and market runs." },
  { key: "time_off", name: "Leave and rest days", description: "Leave requests and rest-off." },
  {
    key: "after_hours",
    name: "After-hours ledger",
    description: "Extra hours worked and how they're settled.",
  },
  { key: "teams_labels", name: "Teams and labels", description: "Grouping staff in big homes." },
  {
    key: "remote_admin",
    name: "Remote admin",
    description: "A manager abroad who follows and approves.",
  },
  { key: "work_record", name: "Work record export", description: "A helper's record as a PDF." },
  {
    key: "staff_pay_hr",
    name: "Staff pay & HR",
    description: "Payslips, paying staff, vale, wage changes, SSS, PhilHealth and Pag-IBIG.",
    switchKey: "staff_pay_hr",
  },
];

export const LIMIT_LABEL: Record<LimitKey, { one: string; many: string; field: string }> = {
  households: { one: "household", many: "households", field: "Households" },
  kasambahay: { one: "kasambahay", many: "kasambahay", field: "Kasambahay" },
  co_managers: { one: "co-manager", many: "co-managers", field: "Co-managers" },
};

const all = (on: FeatureKey[]): Record<FeatureKey, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f.key, on.includes(f.key)])) as Record<
    FeatureKey,
    boolean
  >;

const ESSENTIAL: FeatureKey[] = ["tasks", "quick_utos", "schedule", "pantry", "time_off"];

const FIRST_PUBLISHED = [
  {
    version: 1,
    savedAt: "2026-10-23T03:00:00.000Z",
    savedBy: "Console admin",
    summary: "First published",
  },
];

/**
 * The three launch plans from the subscription summary. Normal's and
 * Premium's prices are placeholders so the Subscriptions preview has paid
 * plans to show; marketing sets the real ones.
 */
export const SAMPLE_CATALOG: CatalogState = {
  plans: [
    {
      id: "free",
      status: "published",
      displayOrder: 1,
      content: {
        name: "Free",
        description: "For one household getting started.",
        prices: { monthly: 0, annual: null, one_time: null },
        trialDays: 0,
        features: all(["tasks", "quick_utos", "schedule"]),
        limits: { households: 1, kasambahay: 1, co_managers: 0 },
      },
      versions: FIRST_PUBLISHED,
    },
    {
      id: "normal",
      status: "published",
      displayOrder: 2,
      pricePlaceholder: true,
      content: {
        name: "Normal",
        description: "All the essentials for a household and its staff.",
        prices: { monthly: 19_900, annual: 199_000, one_time: null },
        trialDays: 14,
        features: all(ESSENTIAL),
        limits: { households: 1, kasambahay: 3, co_managers: 1 },
      },
      versions: FIRST_PUBLISHED,
    },
    {
      id: "premium",
      status: "published",
      displayOrder: 3,
      pricePlaceholder: true,
      content: {
        name: "Premium",
        description: "Everything in Normal, plus the advanced features.",
        prices: { monthly: 39_900, annual: 399_000, one_time: null },
        trialDays: 14,
        features: all(FEATURES.map((f) => f.key)),
        limits: { households: 3, kasambahay: null, co_managers: 3 },
      },
      versions: FIRST_PUBLISHED,
    },
  ],
  addons: [
    {
      id: "extra_household",
      name: "Extra household",
      limitKey: "households",
      step: 1,
      monthlyPrice: 10_000,
      status: "active",
    },
    {
      id: "extra_kasambahay",
      name: "Extra kasambahay",
      limitKey: "kasambahay",
      step: 1,
      monthlyPrice: 5_000,
      status: "active",
    },
    {
      id: "extra_co_manager",
      name: "Extra co-manager",
      limitKey: "co_managers",
      step: 1,
      monthlyPrice: null,
      status: "hidden",
    },
  ],
  switches: [
    {
      key: "staff_pay_hr",
      name: "Staff pay & HR",
      description:
        "Temporarily off while pay and HR are brought in line with the law. Records are kept.",
      covers: [
        "Payslips and paying staff",
        "Vale requests and approvals",
        "Where a helper is paid",
        "Wage changes",
        "SSS, PhilHealth and Pag-IBIG figures",
      ],
      enabled: false,
      updatedAt: "2026-10-26T04:00:00.000Z",
      updatedBy: "SQL editor",
    },
  ],
  switchHistory: [
    {
      id: "sw-1",
      key: "staff_pay_hr",
      enabled: false,
      at: "2026-10-26T04:00:00.000Z",
      by: "SQL editor",
      note: "Turned off while pay and HR are reviewed against the law.",
    },
  ],
  subscriptions: SAMPLE_SUBSCRIPTIONS,
  payments: SAMPLE_PAYMENTS,
};
