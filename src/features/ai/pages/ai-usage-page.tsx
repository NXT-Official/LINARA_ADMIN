import { useQuery } from "@tanstack/react-query";

import { ChartSurface, ColumnChart, type ChartPoint } from "@/components/shared/charts";
import { ExportCsvButton } from "@/components/shared/export-button";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { AI_FEATURE_LABEL } from "@/data/labels";
import { formatCount, formatDateTime } from "@/lib/format";

import { aiUsageFn } from "../ai.actions";
import { AI_HOURLY_CSV, AI_LIMIT_HITS_CSV, AI_TOP_USERS_CSV } from "../ai.export";
import { AI_DAILY_LIMIT, AI_HOURLY_LIMIT, type AiUsage } from "../ai.types";

const HOUR = 3_600_000;
const hourFmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric" });
const featureLabel = (fn: string) => AI_FEATURE_LABEL[fn] ?? fn;

/** Calls per hour as plain bars, oldest on the left. */
function HourBars({ hourly, label }: { hourly: number[]; label: string }) {
  const max = Math.max(1, ...hourly);
  const total = hourly.reduce((a, b) => a + b, 0);
  return (
    <svg
      viewBox={`0 0 ${hourly.length * 6} 32`}
      className="h-8 w-full max-w-60"
      role="img"
      aria-label={`${label}: ${total} calls in 24 hours, at most ${max} in one hour`}
      preserveAspectRatio="none"
    >
      {hourly.map((v, i) => {
        const h = Math.max(1, (v / max) * 30);
        return <rect key={i} x={i * 6} y={32 - h} width={4} height={h} rx={1} fill="var(--pine)" />;
      })}
    </svg>
  );
}

/** The 24 hour starts up to and including the current hour, oldest first. */
function last24Hours(now: number): number[] {
  const current = Math.floor(now / HOUR) * HOUR;
  return Array.from({ length: 24 }, (_, i) => current - (23 - i) * HOUR);
}

/** Per-feature counts in each of the last 24 hours (rows older than that are left out). */
function byFeature(usage: AiUsage, hours: number[]) {
  const index = new Map(hours.map((h, i) => [h, i]));
  const features = new Map<string, number[]>();
  for (const row of usage.hourly) {
    const i = index.get(new Date(row.hour).getTime());
    if (i === undefined) continue;
    const counts = features.get(row.fn) ?? new Array<number>(hours.length).fill(0);
    counts[i] += row.calls;
    features.set(row.fn, counts);
  }
  return [...features.entries()]
    .map(([fn, hourly]) => ({ fn, hourly, total: hourly.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.fn.localeCompare(b.fn));
}

function UserLink({ userId, name }: { userId: string; name: string | null }) {
  return <RecordLink to={`/users/${userId}`}>{name ?? "Unnamed user"}</RecordLink>;
}

export function AiUsagePage() {
  const { data, isPending } = useQuery({ queryKey: ["ai", "usage"], queryFn: () => aiUsageFn() });
  const usage = data?.ok ? data.usage : null;

  return (
    <>
      <PageHeader
        title="AI usage"
        description={`Linara keeps AI call records for 48 hours, so nothing older shows here. Cost isn't recorded. Limits: ${AI_HOURLY_LIMIT} calls an hour per feature, ${AI_DAILY_LIMIT} a day per user.`}
        actions={
          usage ? (
            <ExportCsvButton
              slug="ai-calls-by-feature"
              columns={AI_HOURLY_CSV}
              rows={usage.hourly}
            />
          ) : null
        }
      />
      {usage ? (
        <Usage usage={usage} />
      ) : (
        <Surface>
          <EmptyState title={isPending ? "Loading AI usage" : "AI usage didn't load"}>
            {data && !data.ok ? data.message : null}
          </EmptyState>
        </Surface>
      )}
    </>
  );
}

function Usage({ usage }: { usage: AiUsage }) {
  const hours = last24Hours(Date.now());
  const features = byFeature(usage, hours);
  // The bars' sum, so the figure and the bars agree (calls24h is a rolling 24 hours).
  const total = features.reduce((sum, f) => sum + f.total, 0);
  const perHour: ChartPoint[] = hours.map((h, i) => ({
    key: new Date(h).toISOString(),
    label: hourFmt.format(new Date(h)),
    value: features.reduce((sum, f) => sum + f.hourly[i], 0),
  }));

  return (
    <>
      <div className="mb-6">
        <ChartSurface
          title="Calls per hour"
          description="All features, last 24 hours"
          slug="ai-calls-hourly"
          labelHeader="hour_start"
          valueHeader="calls"
          data={perHour}
          chart={<ColumnChart data={perHour} unit="calls" />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Surface
          title="By feature"
          description={`Last 24 hours, ${formatCount(total)} calls`}
          flush
        >
          {features.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
              No AI calls in the last 24 hours.
            </p>
          ) : (
            <ul className="divide-y divide-border pb-2">
              {features.map((f) => {
                const peak = f.hourly.indexOf(Math.max(...f.hourly));
                return (
                  <li
                    key={f.fn}
                    className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[10rem_5rem_1fr] sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-words text-foreground">
                        {featureLabel(f.fn)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Busiest around {hourFmt.format(new Date(hours[peak]))}
                      </p>
                    </div>
                    <p className="text-xl font-semibold text-foreground sm:text-right">
                      {formatCount(f.total)}
                    </p>
                    <HourBars hourly={f.hourly} label={featureLabel(f.fn)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>

        <div className="space-y-6">
          <Surface
            title="Hit a limit"
            description="Last 48 hours"
            actions={
              <ExportCsvButton
                slug="ai-limit-hits"
                columns={AI_LIMIT_HITS_CSV}
                rows={usage.limitHits}
              />
            }
            flush
          >
            {usage.limitHits.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No one hit a limit.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {usage.limitHits.map((h) => (
                  <li key={`${h.userId}-${h.kind}-${h.fn}`} className="px-5 py-3 sm:px-6">
                    <UserLink userId={h.userId} name={h.name} />
                    <p className="text-xs text-muted-foreground">
                      {h.kind === "hourly"
                        ? `${AI_HOURLY_LIMIT} an hour on ${featureLabel(h.fn ?? "")}`
                        : `${AI_DAILY_LIMIT} in a day`}
                      , {formatDateTime(h.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          <Surface
            title="Most calls"
            description="Last 24 hours"
            actions={
              <ExportCsvButton
                slug="ai-top-users"
                columns={AI_TOP_USERS_CSV}
                rows={usage.topUsers}
              />
            }
            flush
          >
            {usage.topUsers.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
                No AI calls in the last 24 hours.
              </p>
            ) : (
              <ol className="divide-y divide-border pb-2">
                {usage.topUsers.map((t) => (
                  <li
                    key={t.userId}
                    className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
                  >
                    <UserLink userId={t.userId} name={t.name} />
                    <span className="tabular-nums text-sm text-foreground">
                      {formatCount(t.calls)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Surface>
        </div>
      </div>
    </>
  );
}
