export const COST_CATEGORIES = ["infra", "ai", "payments", "support", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<CostCategory, string> = {
  infra: "Infrastructure",
  ai: "AI",
  payments: "Payment fees",
  support: "Support",
  other: "Other",
};

export const RANGE_PRESETS = ["this_month", "last_3_months", "this_year"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Money is integer centavos (PHP, tax-inclusive). A null ratio means its divisor was zero. */
export type FinanceSeriesPoint = {
  /** "YYYY-MM" */
  month: string;
  revenueCentavos: number;
  cogsCentavos: number;
  profitCentavos: number;
  aiCalls: number;
};

export type AiByFn = {
  fn: string;
  calls: number;
  costCentavos: number;
  inputTokens: number;
  outputTokens: number;
};

export type Finance = {
  revenueCentavos: number;
  cogsCentavos: number;
  costEntriesCentavos: number;
  aiCostCentavos: number;
  aiCalls: number;
  costPerCallCentavos: number | null;
  profitCentavos: number;
  payingHouseholds: number;
  users: number;
  profitPerUserCentavos: number | null;
  series: FinanceSeriesPoint[];
  aiByFn: AiByFn[];
};

export type Cost = {
  id: string;
  /** "YYYY-MM-01" */
  month: string;
  category: CostCategory;
  label: string;
  amountCentavos: number;
  note: string | null;
};

/** What staff send to add (no id) or replace (with id) a cost entry. */
export type CostInput = Omit<Cost, "id"> & { id?: string };

export type ModelPrice = {
  model: string;
  inputCentavosPer1m: number;
  outputCentavosPer1m: number;
  audioCentavosPerMinute: number;
  note: string | null;
};

type Num = number | string;

export type DbFinance = {
  revenue_centavos: Num;
  cogs_centavos: Num;
  cost_entries_centavos: Num;
  ai_cost_centavos: Num;
  ai_calls: Num;
  cost_per_call_centavos: Num | null;
  profit_centavos: Num;
  paying_households: Num;
  users: Num;
  profit_per_user_centavos: Num | null;
  series: {
    month: string;
    revenue_centavos: Num;
    cogs_centavos: Num;
    profit_centavos: Num;
    ai_calls: Num;
  }[];
  ai_by_fn: {
    fn: string;
    calls: Num;
    cost_centavos: Num;
    input_tokens: Num;
    output_tokens: Num;
  }[];
};

export type DbCost = {
  id: string;
  month: string;
  category: CostCategory;
  label: string;
  amount_centavos: Num;
  note: string | null;
};

export type DbModelPrice = {
  model: string;
  input_centavos_per_1m: Num;
  output_centavos_per_1m: Num;
  audio_centavos_per_minute: Num;
  note: string | null;
};

const orNull = (n: Num | null) => (n === null ? null : Number(n));

export function financeFromDb(row: DbFinance): Finance {
  return {
    revenueCentavos: Number(row.revenue_centavos),
    cogsCentavos: Number(row.cogs_centavos),
    costEntriesCentavos: Number(row.cost_entries_centavos),
    aiCostCentavos: Number(row.ai_cost_centavos),
    aiCalls: Number(row.ai_calls),
    costPerCallCentavos: orNull(row.cost_per_call_centavos),
    profitCentavos: Number(row.profit_centavos),
    payingHouseholds: Number(row.paying_households),
    users: Number(row.users),
    profitPerUserCentavos: orNull(row.profit_per_user_centavos),
    series: row.series.map((p) => ({
      month: p.month,
      revenueCentavos: Number(p.revenue_centavos),
      cogsCentavos: Number(p.cogs_centavos),
      profitCentavos: Number(p.profit_centavos),
      aiCalls: Number(p.ai_calls),
    })),
    aiByFn: row.ai_by_fn.map((f) => ({
      fn: f.fn,
      calls: Number(f.calls),
      costCentavos: Number(f.cost_centavos),
      inputTokens: Number(f.input_tokens),
      outputTokens: Number(f.output_tokens),
    })),
  };
}

export function costFromDb(row: DbCost): Cost {
  return {
    id: row.id,
    month: row.month,
    category: row.category,
    label: row.label,
    amountCentavos: Number(row.amount_centavos),
    note: row.note,
  };
}

export function modelPriceFromDb(row: DbModelPrice): ModelPrice {
  return {
    model: row.model,
    inputCentavosPer1m: Number(row.input_centavos_per_1m),
    outputCentavosPer1m: Number(row.output_centavos_per_1m),
    audioCentavosPerMinute: Number(row.audio_centavos_per_minute),
    note: row.note,
  };
}
