import { ChartSurface, ColumnChart, type ChartPoint } from "@/components/shared/charts";
import { ExportCsvButton } from "@/components/shared/export-button";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { aiUsage, userById } from "@/data/queries";
import type { CsvColumn } from "@/lib/csv";
import { formatCount, formatDateTime } from "@/lib/format";

/** Limits from LINARA/supabase/add-ai-call-limits.sql. */
const HOURLY_LIMIT = 60;
const DAILY_LIMIT = 300;

const hourFmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric" });

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

type HourRow = { feature: string; hour: string; calls: number };

/** Calls per feature per hour, a long table analysts can pivot (FR-EX-1). */
const HOUR_CSV: CsvColumn<HourRow>[] = [
  { header: "feature", value: (r) => r.feature },
  { header: "hour_start", value: (r) => r.hour },
  { header: "calls", value: (r) => r.calls },
];

/** The start of the hour, `hoursAgo` hours before now. */
function hourStart(now: number, hoursAgo: number) {
  const d = new Date(now - hoursAgo * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
}

export function AiUsagePage() {
  const { features, topUsers, limitHits } = aiUsage();
  const now = Date.now();
  const hours = features[0]?.hourly.length ?? 0;
  const perHour: ChartPoint[] = Array.from({ length: hours }, (_, i) => {
    const start = hourStart(now, hours - 1 - i);
    return {
      key: start.toISOString(),
      label: hourFmt.format(start),
      value: features.reduce((sum, f) => sum + (f.hourly[i] ?? 0), 0),
    };
  });
  const hourRows: HourRow[] = features.flatMap((f) =>
    f.hourly.map((calls, i) => ({
      feature: f.fn,
      hour: hourStart(now, f.hourly.length - 1 - i).toISOString(),
      calls,
    })),
  );

  return (
    <>
      <PageHeader
        title="AI usage"
        description={`Linara keeps AI call records for 48 hours, so nothing older shows here. Cost isn't recorded. Limits: ${HOURLY_LIMIT} calls an hour per feature, ${DAILY_LIMIT} a day per user.`}
        actions={<ExportCsvButton slug="ai-calls-by-feature" columns={HOUR_CSV} rows={hourRows} />}
      />
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
        <Surface title="By feature" description="Last 24 hours" flush>
          <ul className="divide-y divide-border pb-2">
            {features.map((f) => {
              const total = f.hourly.reduce((a, b) => a + b, 0);
              const peak = f.hourly.indexOf(Math.max(...f.hourly));
              const peakAt = new Date(now - (f.hourly.length - 1 - peak) * 3_600_000);
              return (
                <li
                  key={f.fn}
                  className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[10rem_5rem_1fr] sm:px-6"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{f.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Busiest around {hourFmt.format(peakAt)}
                    </p>
                  </div>
                  <p className="text-xl font-semibold text-foreground sm:text-right">
                    {formatCount(total)}
                  </p>
                  <HourBars hourly={f.hourly} label={f.label} />
                </li>
              );
            })}
          </ul>
        </Surface>

        <div className="space-y-6">
          <Surface title="Hit a limit" flush>
            {limitHits.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No one hit a limit.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {limitHits.map((h) => {
                  const user = userById(h.userId);
                  const feature = features.find((f) => f.fn === h.fn)?.label ?? h.fn;
                  return (
                    <li key={`${h.userId}-${h.at}`} className="px-5 py-3 sm:px-6">
                      {user ? (
                        <RecordLink to={`/users/${user.id}`}>{user.fullName}</RecordLink>
                      ) : (
                        "Unknown user"
                      )}
                      <p className="text-xs text-muted-foreground">
                        {h.limit === "hourly"
                          ? `${HOURLY_LIMIT} an hour on ${feature}`
                          : `${DAILY_LIMIT} in a day`}
                        , {formatDateTime(h.at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Surface>
          <Surface title="Most calls" description="Last 24 hours" flush>
            <ol className="divide-y divide-border pb-2">
              {topUsers.map((t) => {
                const user = userById(t.userId);
                return (
                  <li
                    key={t.userId}
                    className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
                  >
                    {user ? (
                      <RecordLink to={`/users/${user.id}`}>{user.fullName}</RecordLink>
                    ) : (
                      "Unknown user"
                    )}
                    <span className="tabular-nums text-sm text-foreground">
                      {formatCount(t.calls24h)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Surface>
        </div>
      </div>
    </>
  );
}
