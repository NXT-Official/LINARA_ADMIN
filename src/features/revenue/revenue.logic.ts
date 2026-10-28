import type { RevenueAction } from "./revenue.types";

/** Manila's calendar date for a moment, "2026-10-28". */
export function manilaDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export const PERIODS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_3", label: "Last 3 months" },
  { value: "last_12", label: "Last 12 months" },
  { value: "this_year", label: "This year" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A period's first and last day in Manila, both included. Months count whole. */
export function periodRange(period: Period, now = new Date()): { from: string; to: string } {
  const [y, m, d] = manilaDate(now).split("-").map(Number);
  const today = `${y}-${pad(m)}-${pad(d)}`;
  const monthStart = (yy: number, mm: number) => {
    const t = new Date(Date.UTC(yy, mm - 1, 1));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
  };
  switch (period) {
    case "this_month":
      return { from: monthStart(y, m), to: today };
    case "last_month": {
      const t = new Date(Date.UTC(y, m - 2, 1));
      const ly = t.getUTCFullYear();
      const lm = t.getUTCMonth() + 1;
      return { from: monthStart(ly, lm), to: `${ly}-${pad(lm)}-${pad(lastDayOf(ly, lm))}` };
    }
    case "last_3":
      return { from: monthStart(y, m - 2), to: today };
    case "last_12":
      return { from: monthStart(y, m - 11), to: today };
    case "this_year":
      return { from: `${y}-01-01`, to: today };
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string =>
  typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** "1,234.50" pesos typed by staff, as centavos; null when it isn't an amount. */
export function pesosToCentavos(input: string): number | null {
  return decimalTimes(input.replace(/[₱,\s]/g, ""), 2, 100);
}

/**
 * Plain digits with at most `places` decimals, times `scale`, rounded to two
 * decimals; null for anything else. Checked by hand, not with a regex.
 */
export function decimalTimes(t: string, places: number, scale: number): number | null {
  const [whole, frac, extra] = t.split(".");
  const digits = (x: string) => x.length > 0 && [...x].every((c) => c >= "0" && c <= "9");
  if (extra !== undefined || !digits(whole)) return null;
  if (frac !== undefined && (!digits(frac) || frac.length > places)) return null;
  return Math.round(Number(t) * scale * 100) / 100;
}

/** Why a change can't be sent, or null when it can. The database checks again. */
export function checkAction(a: RevenueAction): string | null {
  switch (a.type) {
    case "set_fee_rate":
      if (!/^[A-Za-z0-9_]{2,40}$/.test(a.channel))
        return "Enter Xendit's channel code, like GCASH.";
      if (!Number.isFinite(a.percent) || a.percent < 0 || a.percent > 100) {
        return "The percent is between 0 and 100.";
      }
      if (!Number.isInteger(a.flat) || a.flat < 0 || a.flat > 100_000) {
        return "The flat fee is between ₱0 and ₱1,000.";
      }
      return null;
    case "set_ai_rate":
      if (!/^[a-z0-9_-]{2,60}$/.test(a.fn)) return "Unknown AI function.";
      if (!Number.isFinite(a.perCall) || a.perCall < 0 || a.perCall > 100_000) {
        return "The cost per call is between ₱0 and ₱1,000.";
      }
      return null;
    case "add_cost":
      if (!a.name.trim() || a.name.trim().length > 60) return "Name it in 60 characters or fewer.";
      if (!Number.isInteger(a.monthly) || a.monthly <= 0 || a.monthly > 100_000_000) {
        return "Enter the monthly amount, up to ₱1,000,000.";
      }
      if (!isDate(a.startsOn)) return "Choose when it starts.";
      return null;
    case "end_cost":
      if (!/^[0-9a-f-]{36}$/i.test(a.id)) return "Unknown cost.";
      if (!isDate(a.endsOn)) return "Choose when it ends.";
      return null;
  }
}
