/** Query keys for the Finance screen; from/to are in the key so a stale range never shows. */
export const FINANCE_KEYS = {
  all: ["finance"],
  figures: (from: string, to: string) => ["finance", "figures", from, to] as const,
  costs: (from: string, to: string) => ["finance", "costs", from, to] as const,
  prices: ["finance", "prices"],
} as const;
