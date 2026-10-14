import { aiUsage, listHouseholds, listTickets, listUsers } from "@/data/queries";
import { STAGE_DAYS } from "@/features/crm/crm-stage";
import { csvDate, type CsvColumn } from "@/lib/csv";
import { daysBetween } from "@/lib/format";

/**
 * The dashboard's numbers, worked out once, so the figures on screen and the
 * CSV export can never disagree.
 */
export function dashboardMetrics(now: Date = new Date()) {
  const households = listHouseholds();
  const users = listUsers();
  const tickets = listTickets();
  const managers = users.filter((u) => u.kind !== "helper");
  const helpers = households.flatMap((h) => h.helpers);
  const age = (iso: string) => daysBetween(iso, now);
  const open = tickets.filter((t) => t.status === "open");

  return {
    households: households.length,
    householdsNew7d: households.filter((h) => age(h.createdAt) <= 7).length,
    householdsNew30d: households.filter((h) => age(h.createdAt) <= 30).length,
    householdsActive7d: households.filter(
      (h) => h.lastActivityAt && age(h.lastActivityAt) <= STAGE_DAYS.active,
    ).length,
    managers: managers.length,
    managersMultiHome: managers.filter((m) => m.householdIds.length > 1).length,
    helpersActive: helpers.filter((h) => h.status === "ACTIVE").length,
    helpersInvited: helpers.filter((h) => h.status === "PENDING_CLAIM").length,
    helpersEnded: helpers.filter((h) => h.status === "INACTIVE").length,
    aiCalls24h: aiUsage().features.reduce((sum, f) => sum + f.hourly.reduce((a, b) => a + b, 0), 0),
    ticketsOpen: open.length,
    ticketsWaiting: tickets.filter((t) => t.status === "pending").length,
    ticketsUnassigned: open.filter((t) => !t.assigneeId).length,
  };
}

export type DashboardMetrics = ReturnType<typeof dashboardMetrics>;

type MetricRow = { date: string; metric: string; value: number };

/** householdsNew7d -> households_new_7d, the column style analysts expect. */
const snake = (key: string) =>
  key
    .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
    .replace(/(\d)([a-z])/g, "$1$2")
    .toLowerCase();

/** One row per number, in a long format analysts can stack day after day. */
export function metricRows(m: DashboardMetrics, now: Date = new Date()): MetricRow[] {
  const date = csvDate(now.toISOString());
  return (Object.keys(m) as (keyof DashboardMetrics)[]).map((metric) => ({
    date,
    metric: snake(metric),
    value: m[metric],
  }));
}

export const METRIC_COLUMNS: CsvColumn<MetricRow>[] = [
  { header: "date", value: (r) => r.date },
  { header: "metric", value: (r) => r.metric },
  { header: "value", value: (r) => r.value },
];
