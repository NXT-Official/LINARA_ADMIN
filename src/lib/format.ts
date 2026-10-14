/**
 * Dates, money and counts as the business team reads them. Linara runs in the
 * Philippines, so every date is shown in Manila time whatever the browser says.
 */
const ZONE = "Asia/Manila";
const DAY_MS = 86_400_000;

const dateFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const pesoFmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const countFmt = new Intl.NumberFormat("en-PH");

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatPeso(amount: number): string {
  return pesoFmt.format(amount);
}

export function formatCount(n: number): string {
  return countFmt.format(n);
}

/** Calendar days in Manila from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string | Date, to: string | Date): number {
  const day = (d: string | Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(d));
    return Date.parse(`${parts}T00:00:00Z`) / DAY_MS;
  };
  return Math.round(day(to) - day(from));
}

/** "today", "yesterday", "3 days ago", "in 2 days". */
export function formatRelativeDay(iso: string, now: Date = new Date()): string {
  const d = daysBetween(now, iso);
  if (d === 0) return "today";
  if (d === -1) return "yesterday";
  if (d === 1) return "tomorrow";
  return d < 0 ? `${-d} days ago` : `in ${d} days`;
}

/** "1 household", "3 households". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
