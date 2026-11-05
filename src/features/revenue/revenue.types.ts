/** What staff_revenue_report (019-revenue.sql) returns. Amounts are centavos. */
export type RevenueMonth = {
  /** "2026-10" */
  month: string;
  cash: number;
  fees: number;
  ai: number;
  fixed: number;
  profit: number;
  newMrr: number;
  expansion: number;
  contraction: number;
  churn: number;
};

export type RevenueReport = {
  from: string;
  to: string;
  totals: {
    cash: number;
    fees: number;
    ai: number;
    fixed: number;
    profit: number;
    payments: number;
    planCash: number;
    addonCash: number;
  };
  months: RevenueMonth[];
  review: { count: number; amount: number };
  mrr: {
    now: number;
    arr: number;
    paying: number;
    arppu: number;
    pastDue: number;
    pastDueMrr: number;
    ending: number;
    endingMrr: number;
    trials: number;
  };
  movements: {
    new: number;
    newCount: number;
    expansion: number;
    contraction: number;
    cancelled: number;
    kept: number;
    recovered: number;
    recoveredMrr: number;
    churn: number;
    churned: number;
    lapsed: number;
  };
  mix: { planId: string; name: string; cycle: string; count: number; mrr: number }[];
  free: number;
  addons: { addonId: string; name: string; managers: number; quantity: number; mrr: number }[];
  aiUsage: { fn: string; calls: number; perCall: number; cost: number }[];
  settings: {
    feeRates: { channel: string; percent: number; flat: number }[];
    aiRates: { fn: string; perCall: number | null }[];
    costs: { id: string; name: string; monthly: number; startsOn: string; endsOn: string | null }[];
  };
};

export type RevenueAction =
  | { type: "set_fee_rate"; channel: string; percent: number; flat: number }
  | { type: "set_ai_rate"; fn: string; perCall: number }
  | { type: "add_cost"; name: string; monthly: number; startsOn: string }
  | { type: "end_cost"; id: string; endsOn: string };
