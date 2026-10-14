import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { ChartSurface, ColumnChart, TrendChart, type ChartPoint } from "@/components/shared/charts";
import { ExportCsvButton } from "@/components/shared/export-button";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { CUSTOMER_STAGE_LABEL, LEAD_STAGE_LABEL } from "@/data/labels";
import { listContacts, newHouseholdsWeekly, tasksDoneDaily } from "@/data/queries";
import type { CustomerStage, LeadStage } from "@/data/types";
import { csvDate } from "@/lib/csv";
import { daysBetween, formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  METRIC_COLUMNS,
  dashboardMetrics,
  metricRows,
  type DashboardMetrics,
} from "../dashboard-metrics";
import { needsYou, type NeedsYouItem } from "../needs-you";

const GROUP_LABEL: Record<NeedsYouItem["group"], string> = {
  late: "Late",
  today: "Today",
  week: "Next 7 days",
};

const weekday = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "short",
  day: "numeric",
  month: "short",
});

const time = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});

function whenLabel(item: NeedsYouItem, now: Date) {
  if (item.tag) return item.tag;
  if (item.group === "late") {
    const d = -daysBetween(now, item.at);
    return d === 1 ? "1 day late" : `${d} days late`;
  }
  // The group heading already says "Today"; the row gives the time.
  if (item.group === "today") return time.format(new Date(item.at));
  return weekday.format(new Date(item.at));
}

/** The lead of the page: a dated agenda of work waiting on the team. */
function NeedsYou({ now }: { now: Date }) {
  const items = needsYou(now);
  const groups = (["late", "today", "week"] as const)
    .map((g) => ({ g, rows: items.filter((i) => i.group === g) }))
    .filter((x) => x.rows.length > 0);

  return (
    <Surface
      title="Needs you"
      description="Deadlines and problems waiting on the team, soonest first."
      flush
    >
      {items.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyState title="Nothing is waiting">
            New deletion requests, payout problems and follow-ups will show here.
          </EmptyState>
        </div>
      ) : (
        <div className="pb-2">
          {groups.map(({ g, rows }) => (
            <div key={g}>
              <h3
                className={cn(
                  "border-t border-border px-5 pb-1 pt-4 font-sans text-xs font-semibold first:border-t-0 sm:px-6",
                  g === "late" ? "text-status-late-ink" : "text-muted-foreground",
                )}
              >
                {GROUP_LABEL[g]}
                <span className="ml-1.5 tabular-nums">{rows.length}</span>
              </h3>
              <ul className="divide-y divide-border">
                {rows.map((item) => (
                  <li key={item.id} className="relative">
                    <Link
                      to={item.href}
                      className="group grid grid-cols-[5.5rem_1fr_auto] items-start gap-3 px-5 py-3.5 transition-colors hover:bg-sand/60 focus-visible:bg-sand/60 focus-visible:outline-none sm:grid-cols-[7rem_1fr_auto] sm:px-6"
                    >
                      <span
                        className={cn(
                          "pt-0.5 font-display text-sm leading-snug",
                          g === "late" ? "text-status-late-ink" : "text-pine-deep",
                        )}
                      >
                        {whenLabel(item, now)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground group-hover:underline">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">
                          {item.detail}
                        </span>
                      </span>
                      <ChevronRight
                        className="mt-0.5 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

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

function Platform({ m }: { m: DashboardMetrics }) {
  return (
    <Surface title="Platform">
      <ul className="-my-3 divide-y divide-border">
        <Figure
          label="Households"
          value={m.households}
          note={`${m.householdsNew7d} new this week, ${m.householdsNew30d} this month`}
          href="/households"
        />
        <Figure
          label="Active in the last 7 days"
          value={m.householdsActive7d}
          note="A task created or done"
          href="/households"
        />
        <Figure
          label="Managers"
          value={m.managers}
          note={`${m.managersMultiHome} manage more than one home`}
          href="/users"
        />
        <Figure
          label="Helpers working"
          value={m.helpersActive}
          note={`${m.helpersInvited} invited, ${m.helpersEnded} ended`}
          href="/users"
        />
        <Figure label="AI calls, last 24 hours" value={m.aiCalls24h} href="/ai" />
      </ul>
    </Surface>
  );
}
const LEAD_ORDER: LeadStage[] = ["new", "contacted", "interested", "lost"];
const CUSTOMER_ORDER: CustomerStage[] = ["signed_up", "set_up", "active", "at_risk", "inactive"];

function Pipeline({ now }: { now: Date }) {
  const contacts = listContacts(now);
  const leads = contacts.filter((c) => c.kind === "lead");
  const customers = contacts.filter((c) => c.kind === "customer");
  const max = Math.max(
    1,
    ...[...LEAD_ORDER, ...CUSTOMER_ORDER].map((s) => contacts.filter((c) => c.stage === s).length),
  );

  const Row = ({ label, count, warn }: { label: string; count: number; warn?: boolean }) => (
    <li className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 py-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-sand-deep" aria-hidden="true">
        <span
          className={cn("block h-full rounded-full", warn ? "bg-terracotta" : "bg-pine")}
          style={{ width: `${(count / max) * 100}%` }}
        />
      </span>
      <span className="text-right text-sm tabular-nums text-foreground">{count}</span>
    </li>
  );

  return (
    <Surface
      title="CRM"
      actions={
        <Link to="/crm" className="text-sm font-semibold text-pine hover:underline">
          Open CRM
        </Link>
      }
    >
      <h3 className="font-sans text-xs font-semibold text-muted-foreground">
        Leads <span className="tabular-nums">{leads.length}</span>
      </h3>
      <ul className="mt-1">
        {LEAD_ORDER.map((s) => (
          <Row
            key={s}
            label={LEAD_STAGE_LABEL[s]}
            count={leads.filter((c) => c.stage === s).length}
          />
        ))}
      </ul>
      <h3 className="mt-5 font-sans text-xs font-semibold text-muted-foreground">
        Customers <span className="tabular-nums">{customers.length}</span>
      </h3>
      <ul className="mt-1">
        {CUSTOMER_ORDER.map((s) => (
          <Row
            key={s}
            label={CUSTOMER_STAGE_LABEL[s]}
            count={customers.filter((c) => c.stage === s).length}
            warn={s === "at_risk"}
          />
        ))}
      </ul>
    </Surface>
  );
}

function Support({ m }: { m: DashboardMetrics }) {
  return (
    <Surface title="Support">
      <ul className="-my-3 divide-y divide-border">
        <Figure label="Open tickets" value={m.ticketsOpen} href="/support" />
        <Figure label="Waiting on the user" value={m.ticketsWaiting} href="/support" />
        <Figure label="Not assigned" value={m.ticketsUnassigned} href="/support" />
      </ul>
    </Surface>
  );
}

function Activity() {
  const tasks: ChartPoint[] = tasksDoneDaily().map((d) => ({
    key: csvDate(d.day),
    label: shortDay.format(new Date(d.day)),
    value: d.count,
  }));
  const signups: ChartPoint[] = newHouseholdsWeekly().map((w) => ({
    key: csvDate(w.weekStart),
    label: shortDay.format(new Date(w.weekStart)),
    value: w.count,
  }));
  return (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1 [&>*]:min-w-0">
      <ChartSurface
        title="Tasks done"
        description="Per day, all households, last 30 days"
        slug="tasks-done-daily"
        labelHeader="date"
        valueHeader="tasks_done"
        data={tasks}
        chart={<TrendChart data={tasks} unit="tasks done" />}
      />
      <ChartSurface
        title="New households"
        description="Per week, last 12 weeks"
        slug="new-households-weekly"
        labelHeader="week_start"
        valueHeader="new_households"
        data={signups}
        chart={<ColumnChart data={signups} unit="new households" />}
      />
    </div>
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

export function DashboardPage() {
  const now = new Date();
  const m = dashboardMetrics(now);
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={today.format(now)}
        actions={
          <ExportCsvButton slug="dashboard" columns={METRIC_COLUMNS} rows={metricRows(m, now)} />
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <NeedsYou now={now} />
          <Pipeline now={now} />
        </div>
        <div className="space-y-6">
          <Platform m={m} />
          <Support m={m} />
          <Activity />
        </div>
      </div>
    </>
  );
}
