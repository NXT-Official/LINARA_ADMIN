import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { BarList, ChartSurface, ColumnChart, type ChartPoint } from "@/components/shared/charts";
import { SegmentedFilter } from "@/components/shared/list-toolbar";
import { PageHeader, Surface } from "@/components/shared/page";
import { RefreshButton } from "@/components/shared/refresh-button";
import { EmptyState, FiguresSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCan } from "@/features/auth/use-can";
import { formatCentavos } from "@/features/plans/plans.logic";
import { formatCount } from "@/lib/format";
import type { PublicError } from "@/lib/console-error";

import { loadRevenueFn, revenueActionFn } from "../revenue.actions";
import {
  decimalTimes,
  manilaDate,
  PERIODS,
  periodRange,
  pesosToCentavos,
  type Period,
} from "../revenue.logic";
import type { RevenueAction, RevenueReport } from "../revenue.types";

const isError = (r: unknown): r is PublicError =>
  typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;

const monthFmt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabel = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
const CYCLE_WORD: Record<string, string> = {
  monthly: "monthly",
  annual: "yearly",
  one_time: "one-time",
};
/** "-₱1,200" for a loss, "₱1,200" otherwise. */
const signed = (c: number) => (c < 0 ? `-${formatCentavos(-c)}` : formatCentavos(c));

/** A label and its figure, as the Subscriptions screen's summary rows. */
function Row({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  strong?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className={`block text-sm ${strong ? "font-semibold" : ""} text-foreground`}>
          {label}
        </span>
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </span>
      <span
        className={`shrink-0 tabular-nums text-foreground ${strong ? "text-xl font-semibold" : "text-base"}`}
      >
        {value}
      </span>
    </li>
  );
}

/** Revenue (D49): money in, recurring revenue, how subscriptions moved, and profit. */
export function RevenuePage() {
  const [period, setPeriod] = useState<Period>("this_month");
  const range = useMemo(() => periodRange(period), [period]);
  const { data, isPending, dataUpdatedAt } = useQuery({
    queryKey: ["revenue", range.from, range.to],
    queryFn: () => loadRevenueFn({ data: range }),
  });
  const report = data && !isError(data) ? data : null;

  return (
    <>
      <PageHeader
        title="Revenue"
        description="Money in, recurring revenue and profit, in Manila time. Xendit fees and AI usage are estimates from the rates set under Costs."
        actions={<RefreshButton queryKeys={[["revenue"]]} updatedAt={dataUpdatedAt} />}
      />
      <div className="mb-6">
        <SegmentedFilter
          label="Period"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        />
      </div>
      {report ? (
        <Report report={report} />
      ) : (
        <Surface>
          {isPending ? (
            <FiguresSkeleton label="Loading revenue" rows={5} />
          ) : (
            <EmptyState title="Revenue didn't load">
              {data && isError(data) ? data.message : null}
            </EmptyState>
          )}
        </Surface>
      )}
    </>
  );
}

function Report({ report: r }: { report: RevenueReport }) {
  const can = useCan();
  const t = r.totals;
  const mv = r.movements;
  const net = mv.new + mv.expansion - mv.contraction - mv.churn;
  const cashByMonth: ChartPoint[] = r.months.map((m) => ({
    key: m.month,
    label: monthLabel(m.month),
    value: Math.round(m.cash / 100),
  }));
  const mix: ChartPoint[] = r.mix.map((p) => ({
    key: `${p.planId}:${p.cycle}`,
    label: `${p.name}, ${CYCLE_WORD[p.cycle] ?? p.cycle}`,
    value: p.count,
  }));
  const managers = r.mrr.paying + r.free;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start [&>*]:min-w-0">
      <div className="space-y-6">
        <Surface title="Profit" description={`${dayLabel(r.from)} to ${dayLabel(r.to)}`}>
          <ul className="divide-y divide-border">
            <Row
              label="Cash collected"
              value={formatCentavos(t.cash)}
              note={`${formatCount(t.payments)} ${t.payments === 1 ? "payment" : "payments"}: plans ${formatCentavos(t.planCash)}, add-ons ${formatCentavos(t.addonCash)}`}
            />
            <Row
              label="Xendit fees"
              value={`-${formatCentavos(t.fees)}`}
              note="Estimate, from the fee rates"
            />
            <Row
              label="AI usage"
              value={`-${formatCentavos(t.ai)}`}
              note="Estimate, from the cost per call"
            />
            <Row label="Fixed costs" value={`-${formatCentavos(t.fixed)}`} />
            <Row label="Profit" value={signed(t.profit)} strong />
          </ul>
          {r.review.count > 0 ? (
            <p className="mt-4 rounded-xl bg-secondary px-3 py-2 text-sm text-pine-deep">
              {formatCentavos(r.review.amount)} in {formatCount(r.review.count)}{" "}
              {r.review.count === 1 ? "payment" : "payments"} kept for review isn&apos;t counted:
              check it on Subscriptions and refund it in Xendit if needed.
            </p>
          ) : null}
        </Surface>

        <ChartSurface
          title="Cash collected by month"
          description="Paid payments, in pesos"
          slug="revenue-cash-by-month"
          labelHeader="month"
          valueHeader="cash_php"
          data={cashByMonth}
          chart={<ColumnChart data={cashByMonth} unit="pesos" />}
        />

        <Surface
          title="Recurring revenue"
          description="What's running now; a yearly plan counts a twelfth"
        >
          <ul className="divide-y divide-border">
            <Row label="Monthly recurring (MRR)" value={formatCentavos(r.mrr.now)} strong />
            <Row label="Yearly (ARR)" value={formatCentavos(r.mrr.arr)} />
            <Row label="Paying managers" value={formatCount(r.mrr.paying)} />
            <Row
              label="Average per paying manager"
              value={formatCentavos(r.mrr.arppu)}
              note="A month"
            />
            <Row
              label="Past due"
              value={formatCount(r.mrr.pastDue)}
              note={`${formatCentavos(r.mrr.pastDueMrr)} a month at risk`}
            />
            <Row
              label="Ending at period end"
              value={formatCount(r.mrr.ending)}
              note={`${formatCentavos(r.mrr.endingMrr)} a month`}
            />
          </ul>
        </Surface>

        <Surface title="How recurring revenue moved" description="In this period, a month's worth">
          <ul className="divide-y divide-border">
            <Row
              label="New"
              value={`+${formatCentavos(mv.new)}`}
              note={`${formatCount(mv.newCount)} started paying`}
            />
            <Row label="Upgrades and add-ons" value={`+${formatCentavos(mv.expansion)}`} />
            <Row label="Smaller plans" value={`-${formatCentavos(mv.contraction)}`} />
            <Row
              label="Churned"
              value={`-${formatCentavos(mv.churn)}`}
              note={`${formatCount(mv.churned)} cancelled and ended, ${formatCount(mv.lapsed)} unpaid past grace`}
            />
            <Row label="Net" value={signed(net)} strong />
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            {formatCount(mv.cancelled)} set to cancel, {formatCount(mv.kept)} kept again,{" "}
            {formatCount(mv.recovered)} past due paid ({formatCentavos(mv.recoveredMrr)} a month).
            Counted from the day subscription history was switched on.
          </p>
        </Surface>
      </div>

      <div className="space-y-6">
        <Surface
          title="Plans"
          description={`${formatCount(r.mrr.paying)} paying of ${formatCount(managers)} managers${managers ? ` (${Math.round((r.mrr.paying / managers) * 100)}%)` : ""}`}
        >
          {mix.length ? (
            <BarList data={mix} unit="managers" />
          ) : (
            <p className="text-sm text-muted-foreground">Nobody is paying yet.</p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {formatCount(r.free)} on Free
            {r.mrr.trials ? `, ${formatCount(r.mrr.trials)} on a trial` : ""}.
          </p>
        </Surface>

        <Surface title="Add-ons" description="On running plans">
          <ul className="divide-y divide-border">
            {r.addons.map((a) => (
              <Row
                key={a.addonId}
                label={a.name}
                value={formatCentavos(a.mrr)}
                note={`${formatCount(a.quantity)} on ${formatCount(a.managers)} ${a.managers === 1 ? "manager" : "managers"}, a month`}
              />
            ))}
          </ul>
        </Surface>

        <Costs report={r} canManage={can("revenue.manage")} />
      </div>
    </div>
  );
}

/** Per AI call, typed in pesos with up to four decimals, as centavos. */
function perCallCentavos(input: string): number | null {
  return decimalTimes(input.replace(/[₱,\s]/g, ""), 4, 100);
}

function Costs({ report: r, canManage }: { report: RevenueReport; canManage: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const send = async (action: RevenueAction, done: string) => {
    setBusy(true);
    try {
      const res = await revenueActionFn({ data: action });
      if (isError(res)) {
        toast.error(res.message);
        return false;
      }
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ["revenue"] });
      return true;
    } catch {
      toast.error("Couldn't save that. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const [fee, setFee] = useState({ channel: "GCASH", percent: "", flat: "" });
  const [cost, setCost] = useState({ name: "", monthly: "", startsOn: manilaDate(new Date()) });
  const [ai, setAi] = useState<Record<string, string>>({});

  const saveFee = async (e: FormEvent) => {
    e.preventDefault();
    const flat = fee.flat.trim() ? pesosToCentavos(fee.flat) : 0;
    const percent = Number(fee.percent);
    if (flat === null || !fee.percent.trim() || Number.isNaN(percent)) {
      toast.error("Enter the percent, and the flat fee in pesos.");
      return;
    }
    if (
      await send(
        { type: "set_fee_rate", channel: fee.channel.trim().toUpperCase(), percent, flat },
        "Fee rate saved.",
      )
    ) {
      setFee({ channel: "GCASH", percent: "", flat: "" });
    }
  };
  const addCost = async (e: FormEvent) => {
    e.preventDefault();
    const monthly = pesosToCentavos(cost.monthly);
    if (!cost.name.trim() || monthly === null || monthly <= 0) {
      toast.error("Name the cost and enter its monthly amount.");
      return;
    }
    if (
      await send(
        { type: "add_cost", name: cost.name, monthly, startsOn: cost.startsOn },
        "Cost added.",
      )
    ) {
      setCost({ name: "", monthly: "", startsOn: manilaDate(new Date()) });
    }
  };

  const running = r.settings.costs.filter((c) => !c.endsOn || c.endsOn >= manilaDate(new Date()));

  return (
    <Surface
      title="Costs"
      description={canManage ? "What profit is worked out from" : "Set by an admin"}
    >
      <section aria-labelledby="fees-heading">
        <h3 id="fees-heading" className="text-sm font-semibold text-foreground">
          Xendit fee rates
        </h3>
        <p className="text-xs text-muted-foreground">
          By payment channel; DEFAULT covers the rest. Check them against Xendit&apos;s pricing.
        </p>
        <ul className="mt-2 divide-y divide-border">
          {r.settings.feeRates.length === 0 ? (
            <li className="py-2 text-sm text-muted-foreground">No rates yet, so fees count ₱0.</li>
          ) : (
            r.settings.feeRates.map((f) => (
              <li key={f.channel} className="flex justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-foreground">{f.channel}</span>
                <span className="tabular-nums text-muted-foreground">
                  {Number(f.percent)}%{f.flat ? ` + ${formatCentavos(f.flat)}` : ""}
                </span>
              </li>
            ))
          )}
        </ul>
        {canManage ? (
          <form
            onSubmit={saveFee}
            className="mt-3 grid grid-cols-[1fr_5rem_5rem] gap-2"
            aria-label="Set a fee rate"
          >
            <Input
              aria-label="Channel"
              value={fee.channel}
              onChange={(e) => setFee({ ...fee, channel: e.target.value })}
              list="xendit-channels"
            />
            <datalist id="xendit-channels">
              {[
                "DEFAULT",
                "GCASH",
                "PAYMAYA",
                "GRABPAY",
                "SHOPEEPAY",
                "CREDIT_CARD",
                "QRPH",
                "BPI",
                "UNIONBANK",
                "7ELEVEN",
              ].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Input
              aria-label="Percent"
              inputMode="decimal"
              placeholder="%"
              value={fee.percent}
              onChange={(e) => setFee({ ...fee, percent: e.target.value })}
            />
            <Input
              aria-label="Flat fee in pesos"
              inputMode="decimal"
              placeholder="₱"
              value={fee.flat}
              onChange={(e) => setFee({ ...fee, flat: e.target.value })}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy}
              className="col-span-3"
            >
              Save rate
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="ai-heading" className="mt-6 border-t border-border pt-5">
        <h3 id="ai-heading" className="text-sm font-semibold text-foreground">
          AI cost per call
        </h3>
        <p className="text-xs text-muted-foreground">
          {r.aiUsage.length
            ? `${formatCount(r.aiUsage.reduce((n, a) => n + a.calls, 0))} calls in this period.`
            : "No AI calls counted in this period."}
        </p>
        <ul className="mt-2 divide-y divide-border">
          {r.settings.aiRates.map((a) => (
            <li key={a.fn} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-foreground">{a.fn}</span>
              {canManage ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const perCall = perCallCentavos(ai[a.fn] ?? "");
                    if (perCall === null) {
                      toast.error("Enter the cost per call in pesos, like 0.05.");
                      return;
                    }
                    if (await send({ type: "set_ai_rate", fn: a.fn, perCall }, "AI cost saved.")) {
                      setAi({ ...ai, [a.fn]: "" });
                    }
                  }}
                >
                  <Input
                    aria-label={`Cost per call for ${a.fn}, in pesos`}
                    className="h-9 w-24"
                    inputMode="decimal"
                    placeholder={
                      a.perCall === null
                        ? "₱"
                        : `₱${(Number(a.perCall) / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`
                    }
                    value={ai[a.fn] ?? ""}
                    onChange={(e) => setAi({ ...ai, [a.fn]: e.target.value })}
                  />
                  <Button type="submit" size="sm" variant="ghost" disabled={busy}>
                    Save
                  </Button>
                </form>
              ) : (
                <span className="tabular-nums text-muted-foreground">
                  {a.perCall === null ? "Not set" : `₱${Number(a.perCall) / 100}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="fixed-heading" className="mt-6 border-t border-border pt-5">
        <h3 id="fixed-heading" className="text-sm font-semibold text-foreground">
          Fixed monthly costs
        </h3>
        <ul className="mt-2 divide-y divide-border">
          {running.length === 0 ? (
            <li className="py-2 text-sm text-muted-foreground">None running.</li>
          ) : (
            running.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-foreground">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatCentavos(c.monthly)} a month from {dayLabel(c.startsOn)}
                    {c.endsOn ? ` to ${dayLabel(c.endsOn)}` : ""}
                  </span>
                </span>
                {canManage && !c.endsOn ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`End ${c.name} today`}
                    onClick={() =>
                      void send(
                        { type: "end_cost", id: c.id, endsOn: manilaDate(new Date()) },
                        `${c.name} ends today.`,
                      )
                    }
                  >
                    End
                  </Button>
                ) : null}
              </li>
            ))
          )}
        </ul>
        {canManage ? (
          <form
            onSubmit={addCost}
            className="mt-3 grid grid-cols-2 gap-2"
            aria-label="Add a fixed cost"
          >
            <Input
              aria-label="Cost name"
              placeholder="Name, like Supabase Pro"
              className="col-span-2"
              value={cost.name}
              onChange={(e) => setCost({ ...cost, name: e.target.value })}
            />
            <Input
              aria-label="Monthly amount in pesos"
              inputMode="decimal"
              placeholder="₱ a month"
              value={cost.monthly}
              onChange={(e) => setCost({ ...cost, monthly: e.target.value })}
            />
            <Input
              aria-label="Starts on"
              type="date"
              value={cost.startsOn}
              onChange={(e) => setCost({ ...cost, startsOn: e.target.value })}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy}
              className="col-span-2"
            >
              Add cost
            </Button>
          </form>
        ) : null}
      </section>
    </Surface>
  );
}
