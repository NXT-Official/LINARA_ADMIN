import { csvDate, type CsvColumn } from "@/lib/csv";

import type { DashboardData, DashboardNumbers } from "./dashboard.types";

/** The dashboard's numbers in the order they show, so the screen and the CSV agree. */
const NUMBER_KEYS: (keyof DashboardNumbers)[] = [
  "households",
  "householdsNew7d",
  "householdsNew30d",
  "householdsActive7d",
  "managers",
  "managersMultiHome",
  "helpersActive",
  "helpersInvited",
  "helpersEnded",
];

type MetricRow = { date: string; metric: string; value: number };

/** householdsNew7d -> households_new_7d, the column style analysts expect. */
const snake = (key: string) =>
  key
    .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
    .replace(/(\d)([a-z])/g, "$1$2")
    .toLowerCase();

/** One row per number, in a long format analysts can stack day after day. */
export function metricRows(d: DashboardData, now: Date = new Date()): MetricRow[] {
  const date = csvDate(now.toISOString());
  return NUMBER_KEYS.map((key) => ({ date, metric: snake(key), value: d[key] }));
}

export const METRIC_COLUMNS: CsvColumn<MetricRow>[] = [
  { header: "date", value: (r) => r.date },
  { header: "metric", value: (r) => r.metric },
  { header: "value", value: (r) => r.value },
];
