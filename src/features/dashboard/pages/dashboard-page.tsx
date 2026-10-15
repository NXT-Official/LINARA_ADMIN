import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { ChartSurface, ColumnChart, TrendChart, type ChartPoint } from "@/components/shared/charts";
import { ExportCsvButton } from "@/components/shared/export-button";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { formatCount } from "@/lib/format";

import { getDashboardFn } from "../dashboard.actions";
import { METRIC_COLUMNS, metricRows } from "../dashboard-metrics";
import type { DashboardData } from "../dashboard.types";

/** A figure with its label, linking to the list it summarises (FR-DB-8). */
function Figure({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: number;
  note?: string;
  href: string;
}) {
  return (
    <li>
      <Link
        to={href}
        className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:text-pine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-sm text-foreground">{label}</span>
          {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
        </span>
        {/* Proportional sans figures: the serif is for headings, not numbers. */}
        <span className="text-xl font-semibold text-foreground">{formatCount(value)}</span>
      </Link>
    </li>
  );
}

function Platform({ d }: { d: DashboardData }) {
  return (
    <Surface title="Platform">
      <ul className="-my-3 divide-y divide-border">
        <Figure
          label="Households"
          value={d.households}
          note={`${d.householdsNew7d} new this week, ${d.householdsNew30d} this month`}
          href="/households"
        />
        <Figure
          label="Active in the last 7 days"
          value={d.householdsActive7d}
          note="A task scheduled or done"
          href="/households"
        />
        <Figure
          label="Managers"
          value={d.managers}
          note={`${d.managersMultiHome} manage more than one home`}
          href="/users"
        />
        <Figure
          label="Helpers working"
          value={d.helpersActive}
          note={`${d.helpersInvited} invited, ${d.helpersEnded} ended`}
          href="/users"
        />
      </ul>
    </Surface>
  );
}

/** Modules that aren't on real data yet: named, never shown as zero (FR-DB-9). */
function LaterPhases() {
  return (
    <Surface
      title="Not on live data yet"
      description="These figures join the dashboard as each part of the console is built."
    >
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>CRM: arrives in Phase 3</li>
        <li>Deletion requests: arrive in Phase 4</li>
        <li>Support tickets: arrive in Phase 5</li>
        <li>Payouts and AI usage: arrive in Phase 6</li>
      </ul>
    </Surface>
  );
}

const shortDay = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  day: "numeric",
  month: "short",
});
const today = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** A Manila calendar date, YYYY-MM-DD, as a label. Noon keeps it on the same day in any zone. */
const dayLabel = (day: string) => shortDay.format(new Date(`${day}T12:00:00+08:00`));

function Activity({ d }: { d: DashboardData }) {
  const tasks: ChartPoint[] = d.tasksDoneDaily.map((x) => ({
    key: x.day,
    label: dayLabel(x.day),
    value: x.count,
  }));
  const signups: ChartPoint[] = d.newHouseholdsWeekly.map((w) => ({
    key: w.weekStart,
    label: dayLabel(w.weekStart),
    value: w.count,
  }));
  return (
    <>
      <ChartSurface
        title="Tasks done"
        description="Per day, all households, last 14 days"
        slug="tasks-done-daily"
        labelHeader="date"
        valueHeader="tasks_done"
        data={tasks}
        chart={<TrendChart data={tasks} unit="tasks done" />}
      />
      <ChartSurface
        title="New households"
        description="Per week from Monday, last 8 weeks"
        slug="new-households-weekly"
        labelHeader="week_start"
        valueHeader="new_households"
        data={signups}
        chart={<ColumnChart data={signups} unit="new households" />}
      />
    </>
  );
}

export function DashboardPage() {
  const now = new Date();
  const { data, isPending } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
  });
  const d = data?.ok ? data.data : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={today.format(now)}
        actions={
          d ? (
            <ExportCsvButton slug="dashboard" columns={METRIC_COLUMNS} rows={metricRows(d, now)} />
          ) : null
        }
      />
      {d ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <div className="space-y-6">
            <Activity d={d} />
          </div>
          <div className="space-y-6">
            <Platform d={d} />
            <LaterPhases />
          </div>
        </div>
      ) : (
        <Surface>
          <EmptyState title={isPending ? "Loading the dashboard" : "The dashboard didn't load"}>
            {data && !data.ok ? data.message : null}
          </EmptyState>
        </Surface>
      )}
    </>
  );
}
