import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { ChartSurface, ColumnChart, TrendChart, type ChartPoint } from "@/components/shared/charts";
import { ExportCsvButton } from "@/components/shared/export-button";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { CUSTOMER_STAGE_LABEL, LEAD_STAGE_LABEL } from "@/data/labels";
import type { CustomerStage, LeadStage } from "@/data/types";
import { crmDashboardFn } from "@/features/crm/crm.actions";
import { deletionCountsFn } from "@/features/deletions/deletions.actions";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { getDashboardFn } from "../dashboard.actions";
import { METRIC_COLUMNS, metricRows } from "../dashboard-metrics";
import type { DashboardData } from "../dashboard.types";

/** A figure with its label, linking to the list it summarises (FR-DB-8). */
function Figure({
  label,
  value,
  note,
  href,
  search,
}: {
  label: string;
  value: number;
  note?: string;
  href: string;
  search?: Record<string, string>;
}) {
  return (
    <li>
      <Link
        to={href}
        search={search}
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

/** Account deletion requests against their 30-day deadline (FR-DB-4). Its own query. */
function Deletions() {
  const { data, isPending } = useQuery({
    queryKey: ["deletions", "counts"],
    queryFn: () => deletionCountsFn(),
  });
  if (!data?.ok) {
    return (
      <Surface title="Deletion requests">
        <EmptyState title={isPending ? "Loading" : "The deletion figures didn't load"}>
          {data && !data.ok ? data.message : null}
        </EmptyState>
      </Surface>
    );
  }
  const c = data.counts;
  return (
    <Surface title="Deletion requests">
      <ul className="-my-3 divide-y divide-border">
        <Figure label="Deletion requests waiting" value={c.pending} href="/deletions" />
        <Figure label="Due within 7 days" value={c.dueSoon} href="/deletions" />
        <Figure label="Past the 30-day deadline" value={c.overdue} href="/deletions" />
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
        <li>Support tickets: arrive in Phase 5</li>
        <li>Payouts and AI usage: arrive in Phase 6</li>
      </ul>
    </Surface>
  );
}

const LEAD_ORDER: LeadStage[] = ["new", "contacted", "interested", "lost"];
const CUSTOMER_ORDER: CustomerStage[] = ["signed_up", "set_up", "active", "at_risk", "inactive"];

/** One stage as a row with a bar, linking to the list filtered to it (FR-DB-8). */
function StageRow({
  label,
  count,
  max,
  search,
  warn,
}: {
  label: string;
  count: number;
  max: number;
  search: Record<string, string>;
  warn?: boolean;
}) {
  return (
    <li>
      <Link
        to="/crm"
        search={search}
        className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 rounded-lg py-1.5 transition-colors hover:text-pine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-sm text-foreground">{label}</span>
        <span className="h-2 overflow-hidden rounded-full bg-sand-deep" aria-hidden="true">
          <span
            className={cn("block h-full rounded-full", warn ? "bg-terracotta" : "bg-pine")}
            style={{ width: `${(count / max) * 100}%` }}
          />
        </span>
        <span className="text-right text-sm tabular-nums text-foreground">
          {formatCount(count)}
        </span>
      </Link>
    </li>
  );
}

/** Leads, customers and follow-ups (FR-DB-7). Its own query: it fails on its own. */
function CrmPipeline() {
  const { data, isPending } = useQuery({
    queryKey: ["crm", "dashboard"],
    queryFn: () => crmDashboardFn(),
  });
  if (!data?.ok) {
    return (
      <Surface title="CRM">
        <EmptyState title={isPending ? "Loading the CRM figures" : "The CRM figures didn't load"}>
          {data && !data.ok ? data.message : null}
        </EmptyState>
      </Surface>
    );
  }
  const c = data.crm;
  const max = Math.max(1, ...Object.values(c.leadsByStage), ...Object.values(c.customersByStage));
  const leads = LEAD_ORDER.reduce((n, s) => n + c.leadsByStage[s], 0);
  const customers = CUSTOMER_ORDER.reduce((n, s) => n + c.customersByStage[s], 0);
  return (
    <Surface
      title="CRM"
      actions={
        <Link to="/crm" className="text-sm font-semibold text-pine hover:underline">
          Open CRM
        </Link>
      }
    >
      <ul className="-mt-3 mb-4 divide-y divide-border">
        <Figure
          label="Follow-ups overdue"
          value={c.followUpsOverdue}
          href="/crm"
          search={{ due: "overdue" }}
        />
        <Figure
          label="Follow-ups due today"
          value={c.followUpsDueToday}
          href="/crm"
          search={{ due: "today" }}
        />
        <Figure
          label="Became customers, last 30 days"
          value={c.converted30d}
          note="Leads linked to a Linara account"
          href="/crm"
          search={{ kind: "customer" }}
        />
      </ul>
      <h3 className="font-sans text-xs font-semibold text-muted-foreground">
        Leads <span className="tabular-nums">{formatCount(leads)}</span>
      </h3>
      <ul className="mt-1">
        {LEAD_ORDER.map((s) => (
          <StageRow
            key={s}
            label={LEAD_STAGE_LABEL[s]}
            count={c.leadsByStage[s]}
            max={max}
            search={{ kind: "lead", stage: s }}
          />
        ))}
      </ul>
      <h3 className="mt-5 font-sans text-xs font-semibold text-muted-foreground">
        Customers <span className="tabular-nums">{formatCount(customers)}</span>
      </h3>
      <ul className="mt-1">
        {CUSTOMER_ORDER.map((s) => (
          <StageRow
            key={s}
            label={CUSTOMER_STAGE_LABEL[s]}
            count={c.customersByStage[s]}
            max={max}
            search={{ kind: "customer", stage: s }}
            warn={s === "at_risk"}
          />
        ))}
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
            <CrmPipeline />
            <Activity d={d} />
          </div>
          <div className="space-y-6">
            <Platform d={d} />
            <Deletions />
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
