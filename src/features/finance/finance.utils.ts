import type { Finance, RangePreset } from "./finance.types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** ISO first and last day for a preset, in the viewer's local calendar. */
export function rangeFor(preset: RangePreset, today: Date): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (preset === "this_year") return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
  const start = preset === "this_month" ? new Date(y, m, 1) : new Date(y, m - 2, 1);
  const lastDay = new Date(y, m + 1, 0).getDate();
  return {
    from: iso(start.getFullYear(), start.getMonth() + 1, 1),
    to: iso(y, m + 1, lastDay),
  };
}

/** One month of the money chart, in pesos (the chart's axis unit). */
export type MoneyPoint = {
  /** Short month name, e.g. "Oct". */
  month: string;
  revenue: number;
  cogs: number;
  profit: number;
};

/** Chart rows in pesos with short month names. */
export function seriesForChart(finance: Pick<Finance, "series">): MoneyPoint[] {
  return finance.series.map((p) => {
    const index = Number(p.month.slice(5, 7)) - 1;
    return {
      month: MONTHS[index] ?? p.month,
      revenue: p.revenueCentavos / 100,
      cogs: p.cogsCentavos / 100,
      profit: p.profitCentavos / 100,
    };
  });
}

/** Compact peso axis label with a true minus sign: "−₱1.2K". */
export function pesoAxisLabel(pesos: number): string {
  const abs = Math.abs(pesos);
  const body =
    abs >= 1000
      ? `${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`
      : String(abs);
  return `${pesos < 0 ? "−" : ""}₱${body}`;
}

/** "2026-10-01" to "October 2026". */
export function monthHeading(isoDate: string): string {
  const index = Number(isoDate.slice(5, 7)) - 1;
  const full = new Date(2000, index, 1).toLocaleString("en-US", { month: "long" });
  return `${full} ${isoDate.slice(0, 4)}`;
}
