import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import { DataTable, rowLinkClass, type Column } from "@/components/shared/data-table";
import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip, type ChipTone } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SampleActions } from "@/features/plans/components/sample-bar";
import { CYCLE_LABEL, formatCentavos } from "@/features/plans/plans.logic";
import { dispatchBilling, useCatalog } from "@/features/plans/plans.store";
import type { CatalogState, Cycle } from "@/features/plans/plans.types";
import { formatCount, formatDate } from "@/lib/format";

import {
  addonsLabel,
  MAX_ADDON_QUANTITY,
  offeredPlans,
  planLabel,
  pricedCycles,
  quote,
  summarize,
  type BillingAction,
  type BillingResult,
} from "../billing.logic";
import {
  PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  type Subscription,
  type SubscriptionAddon,
  type SubscriptionStatus,
} from "../billing.types";

type Tab = "subscriptions" | "payments";
type SubFilter = "all" | SubscriptionStatus | "ending";

const SUB_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "On trial",
  past_due: "Past due",
  cancelled: "Cancelled",
};
const SUB_TONE: Record<SubscriptionStatus, ChipTone> = {
  active: "done",
  trialing: "neutral",
  past_due: "danger",
  cancelled: "quiet",
};
const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  pending: "Pending",
};
const PAYMENT_TONE: Record<PaymentStatus, ChipTone> = {
  paid: "done",
  failed: "danger",
  refunded: "quiet",
  pending: "attention",
};
const CHANNEL: Record<PaymentMethod["channel"], string> = {
  GCASH: "GCash",
  MAYA: "Maya",
  CARD: "Card",
};

function methodLabel(m: PaymentMethod | null) {
  return m ? `${CHANNEL[m.channel]} ending ${m.ending}` : "None";
}

function amountLabel(amount: number, cycle: Cycle) {
  return amount === 0 ? "Free" : `${formatCentavos(amount)} ${CYCLE_LABEL[cycle].per}`;
}

/** The status chip, plus "Ends" when the payer cancelled for the period's end. */
function SubStatus({ sub }: { sub: Subscription }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <StatusChip tone={SUB_TONE[sub.status]}>{SUB_LABEL[sub.status]}</StatusChip>
      {sub.cancelAtPeriodEnd && sub.status !== "cancelled" ? (
        <StatusChip tone="late">Ends at period end</StatusChip>
      ) : null}
    </span>
  );
}

function periodLabel(sub: Subscription) {
  if (!sub.periodEnd) return "No renewal";
  const when = formatDate(sub.periodEnd);
  if (sub.status === "cancelled") return `Ended ${when}`;
  if (sub.status === "trialing") return `Trial ends ${when}`;
  if (sub.status === "past_due") return `Was due ${when}`;
  return sub.cancelAtPeriodEnd ? `Ends ${when}` : `Renews ${when}`;
}

/** Every action changes only the on-screen sample, and says so (D40). */
const SAMPLE_NOTE = "Sample data: nothing was charged or saved.";

function ChangePlanDialog({ sub, state }: { sub: Subscription; state: CatalogState }) {
  const base = useId();
  const plans = offeredPlans(state);
  const offeredAddons = state.addons.filter(
    (a) => a.status === "active" && a.monthlyPrice !== null,
  );
  const [planId, setPlanId] = useState(
    plans.some((p) => p.id === sub.planId) ? sub.planId : (plans[0]?.id ?? ""),
  );
  const plan = plans.find((p) => p.id === planId);
  const cycles = plan ? pricedCycles(plan) : [];
  const [cycleState, setCycle] = useState<Cycle>(sub.cycle);
  const cycle = cycles.includes(cycleState) ? cycleState : (cycles[0] ?? "monthly");
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(sub.addons.map((a) => [a.addonId, String(a.quantity)])),
  );
  const paid = !!plan && (plan.content.prices[cycle] ?? 0) > 0 && cycle !== "one_time";
  const addons: SubscriptionAddon[] = paid
    ? offeredAddons.map((a) => ({
        addonId: a.id,
        quantity: /^\d{1,2}$/.test((qty[a.id] ?? "0").trim()) ? Number(qty[a.id] ?? "0") : -1,
      }))
    : [];
  const q = plan ? quote(state, plan.id, cycle, addons) : null;

  return (
    <FormDialog
      trigger={<Button variant="outline">Change plan</Button>}
      title="Change plan"
      description={`${sub.householdName}. The new plan starts today, at the plan's current version. ${SAMPLE_NOTE}`}
      submitLabel="Change plan"
      done={`Plan changed. ${SAMPLE_NOTE}`}
      canSubmit={!!q?.ok}
      onSubmit={async () =>
        dispatchBilling({
          type: "change_plan",
          subscriptionId: sub.id,
          planId,
          cycle,
          addons,
        })
      }
    >
      {(id) => (
        <>
          <Field label="Plan" htmlFor={id("plan")} hint="Only published plans are offered.">
            <SelectField
              id={id("plan")}
              value={planId}
              onChange={setPlanId}
              options={plans.map((p) => ({ value: p.id, label: p.content.name }))}
            />
          </Field>
          {cycles.length > 1 ? (
            <Field label="Billed" htmlFor={id("cycle")}>
              <SelectField
                id={id("cycle")}
                value={cycle}
                onChange={setCycle}
                options={cycles.map((c) => ({
                  value: c,
                  label: `${CYCLE_LABEL[c].field}, ${formatCentavos(plan?.content.prices[c] ?? 0)}`,
                }))}
              />
            </Field>
          ) : null}
          {paid && offeredAddons.length ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-muted-foreground">Add-ons</legend>
              {offeredAddons.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3">
                  <label htmlFor={`${base}-${a.id}`} className="min-w-0 text-sm text-foreground">
                    {a.name}{" "}
                    <span className="text-muted-foreground">
                      {formatCentavos(a.monthlyPrice ?? 0)} a month each
                    </span>
                  </label>
                  <Input
                    id={`${base}-${a.id}`}
                    inputMode="numeric"
                    className="w-20 shrink-0"
                    value={qty[a.id] ?? "0"}
                    onChange={(e) => setQty({ ...qty, [a.id]: e.target.value })}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                0 to {MAX_ADDON_QUANTITY} of each. A yearly plan pays twelve months of add-ons.
              </p>
            </fieldset>
          ) : null}
          <p
            className={`text-sm ${q && !q.ok ? "font-semibold text-destructive" : "text-foreground"}`}
            aria-live="polite"
          >
            {!q
              ? "No plan is published."
              : q.ok
                ? `New price: ${amountLabel(q.amount, cycle)}`
                : q.message}
          </p>
        </>
      )}
    </FormDialog>
  );
}

function ConfirmAction({
  label,
  title,
  description,
  done,
  destructive,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  done: string;
  destructive?: boolean;
  onConfirm: () => BillingResult;
}) {
  return (
    <FormDialog
      trigger={
        <Button variant={destructive ? "destructive" : "outline"} size="sm">
          {label}
        </Button>
      }
      title={title}
      description={`${description} ${SAMPLE_NOTE}`}
      submitLabel={label}
      done={`${done} ${SAMPLE_NOTE}`}
      destructive={destructive}
      onSubmit={async () => onConfirm()}
    >
      {null}
    </FormDialog>
  );
}

const act = (a: BillingAction) => () => dispatchBilling(a);

function PaymentActions({ payment }: { payment: Payment }) {
  if (payment.status === "failed") {
    return (
      <ConfirmAction
        label="Retry payment"
        title="Retry this payment"
        description={`Charge ${formatCentavos(payment.amount)} to ${methodLabel(payment.method)} again.`}
        done="Payment retried and paid."
        onConfirm={act({ type: "retry_payment", paymentId: payment.id })}
      />
    );
  }
  if (payment.status === "paid" && payment.amount > 0) {
    return (
      <ConfirmAction
        label="Refund"
        title="Refund this payment"
        description={`Return ${formatCentavos(payment.amount)} to ${methodLabel(payment.method)}.`}
        done="Payment refunded."
        destructive
        onConfirm={act({ type: "refund_payment", paymentId: payment.id })}
      />
    );
  }
  return null;
}

function SubscriptionDialog({
  sub,
  state,
  onClose,
}: {
  sub: Subscription;
  state: CatalogState;
  onClose: () => void;
}) {
  const payments = state.payments.filter((p) => p.subscriptionId === sub.id);
  const renews = sub.amount > 0 && sub.periodEnd !== null && sub.status !== "cancelled";
  const plan = state.plans.find((p) => p.id === sub.planId);
  const latest = plan?.versions[0]?.version ?? sub.planVersion;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl font-normal">
            {sub.householdName}
          </DialogTitle>
          <DialogDescription>Paid by {sub.payerName}. Sample data.</DialogDescription>
        </DialogHeader>
        <DetailList
          items={[
            {
              label: "Plan",
              value: (
                <>
                  {planLabel(state, sub)}, version {sub.planVersion}
                  {latest > sub.planVersion ? (
                    <span className="block text-xs text-muted-foreground">
                      The plan is on version {latest} now; this household keeps version{" "}
                      {sub.planVersion}.
                    </span>
                  ) : null}
                </>
              ),
            },
            { label: "Add-ons", value: addonsLabel(state.addons, sub.addons) || "None" },
            { label: "Price", value: amountLabel(sub.amount, sub.cycle) },
            { label: "Status", value: <SubStatus sub={sub} /> },
            { label: "Period", value: periodLabel(sub) },
            { label: "Subscribed since", value: formatDate(sub.startedAt) },
            { label: "Pays with", value: methodLabel(sub.method) },
          ]}
        />
        <div className="flex flex-wrap gap-2 pt-2">
          <ChangePlanDialog key={JSON.stringify(sub)} sub={sub} state={state} />
          {renews && !sub.cancelAtPeriodEnd ? (
            <ConfirmAction
              label="Cancel at period end"
              title="Cancel at the period's end"
              description={`The plan stays on until ${formatDate(sub.periodEnd as string)}, then the household moves to Free.`}
              done="Set to end at the period's end."
              destructive
              onConfirm={act({ type: "cancel_at_period_end", subscriptionId: sub.id })}
            />
          ) : null}
          {renews && sub.cancelAtPeriodEnd ? (
            <ConfirmAction
              label="Keep subscription"
              title="Keep this subscription"
              description="It renews as usual at the period's end."
              done="Subscription kept."
              onConfirm={act({ type: "resume", subscriptionId: sub.id })}
            />
          ) : null}
        </div>
        <div className="pt-2">
          <h3 className="text-sm font-semibold text-foreground">Payments</h3>
          {payments.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatCentavos(p.amount)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {formatDate(p.createdAt)}, {p.reference}
                    </span>
                    {p.failureReason ? (
                      <div className="text-xs text-muted-foreground">{p.failureReason}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip tone={PAYMENT_TONE[p.status]}>{PAYMENT_LABEL[p.status]}</StatusChip>
                    <PaymentActions payment={p} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionsTab({
  state,
  filter,
  onFilter,
}: {
  state: CatalogState;
  filter: SubFilter;
  onFilter: (f: SubFilter) => void;
}) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const subs = state.subscriptions;
  const matches = (s: Subscription, f: SubFilter) =>
    f === "all" ||
    (f === "ending" ? s.cancelAtPeriodEnd && s.status !== "cancelled" : s.status === f);
  const q = search.trim().toLowerCase();
  const rows = subs.filter(
    (s) =>
      matches(s, filter) && (!q || `${s.householdName} ${s.payerName}`.toLowerCase().includes(q)),
  );
  const open = subs.find((s) => s.id === openId) ?? null;

  const columns: Column<Subscription>[] = [
    {
      key: "household",
      header: "Household",
      mobile: "primary",
      cell: (s) => (
        <div className="min-w-0">
          <button
            type="button"
            className={`${rowLinkClass} text-left`}
            onClick={() => setOpenId(s.id)}
          >
            {s.householdName}
          </button>
          <div className="text-xs text-muted-foreground">Paid by {s.payerName}</div>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: (s) => {
        const extras = addonsLabel(state.addons, s.addons);
        return (
          <div>
            <span className="whitespace-nowrap">{planLabel(state, s)}</span>
            {extras ? <div className="text-xs text-muted-foreground">{extras}</div> : null}
          </div>
        );
      },
    },
    { key: "status", header: "Status", mobile: "primary", cell: (s) => <SubStatus sub={s} /> },
    {
      key: "period",
      header: "Period",
      cell: (s) => <span className="whitespace-nowrap">{periodLabel(s)}</span>,
    },
    { key: "method", header: "Pays with", mobile: "hidden", cell: (s) => methodLabel(s.method) },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (s) => (
        <span className="whitespace-nowrap tabular-nums">{amountLabel(s.amount, s.cycle)}</span>
      ),
    },
  ];

  return (
    <>
      <ListToolbar>
        <SearchField value={search} onChange={setSearch} label="Search by household or payer" />
        <SegmentedFilter
          label="Subscription status"
          value={filter}
          onChange={onFilter}
          options={[
            { value: "all" as SubFilter, label: "All", count: subs.length },
            ...SUBSCRIPTION_STATUSES.map((st) => ({
              value: st as SubFilter,
              label: SUB_LABEL[st],
              count: subs.filter((s) => matches(s, st)).length,
            })),
            {
              value: "ending" as SubFilter,
              label: "Ending",
              count: subs.filter((s) => matches(s, "ending")).length,
            },
          ]}
        />
      </ListToolbar>
      <DataTable
        label="Subscriptions"
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        empty={
          <EmptyState title="No subscriptions match">
            Try another filter, or clear the search.
          </EmptyState>
        }
      />
      {open ? (
        <SubscriptionDialog sub={open} state={state} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function PaymentsTab({ state }: { state: CatalogState }) {
  const [status, setStatus] = useState<"all" | PaymentStatus>("all");
  const subById = useMemo(
    () => new Map(state.subscriptions.map((s) => [s.id, s])),
    [state.subscriptions],
  );
  const rows = state.payments
    .filter((p) => status === "all" || p.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns: Column<Payment>[] = [
    {
      key: "household",
      header: "Household",
      mobile: "primary",
      cell: (p) => (
        <span className="font-semibold text-foreground">
          {subById.get(p.subscriptionId)?.householdName ?? "Unknown household"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "primary",
      cell: (p) => (
        <div>
          <StatusChip tone={PAYMENT_TONE[p.status]}>{PAYMENT_LABEL[p.status]}</StatusChip>
          {p.failureReason ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{p.failureReason}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (p) => <span className="tabular-nums">{formatCentavos(p.amount)}</span>,
    },
    { key: "method", header: "Paid with", mobile: "hidden", cell: (p) => methodLabel(p.method) },
    {
      key: "ref",
      header: "Reference",
      mobile: "hidden",
      cell: (p) => <span className="tabular-nums">{p.reference}</span>,
    },
    {
      key: "at",
      header: "Date",
      cell: (p) => <span className="whitespace-nowrap">{formatDate(p.createdAt)}</span>,
    },
    { key: "actions", header: "", cell: (p) => <PaymentActions payment={p} /> },
  ];

  return (
    <>
      <ListToolbar>
        <SegmentedFilter
          label="Payment status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All", count: state.payments.length },
            ...PAYMENT_STATUSES.map((st) => ({
              value: st,
              label: PAYMENT_LABEL[st],
              count: state.payments.filter((p) => p.status === st).length,
            })),
          ]}
        />
      </ListToolbar>
      <DataTable
        label="Payments"
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        empty={<EmptyState title="No payments match">Try another filter.</EmptyState>}
      />
    </>
  );
}

function SummaryRow({
  label,
  value,
  note,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </span>
      <span className="text-xl font-semibold text-foreground tabular-nums">{value}</span>
    </>
  );
  const cls = "flex w-full items-baseline justify-between gap-4 py-3 text-left";
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`${cls} cursor-pointer transition-colors hover:text-pine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/**
 * Subscriptions screen, a preview on sample data held in the tab (D40). It
 * shares the plan catalog with the Plans screen (D47), so a price or plan
 * changed there is what "Change plan" offers here.
 */
export function BillingPage() {
  const state = useCatalog();
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [subFilter, setSubFilter] = useState<SubFilter>("all");
  const summary = summarize(state);
  const show = (f: SubFilter) => {
    setTab("subscriptions");
    setSubFilter(f);
  };

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Households' subscriptions and payments. This is a preview on sample data: Linara has no billing yet, so nothing here charges, refunds or saves."
        actions={
          <>
            <SampleActions />
            <Button variant="outline" asChild>
              <Link to="/plans">Plans</Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <Surface flush className="order-2 lg:order-1">
          <div className="space-y-3 pt-5">
            <div className="px-5 sm:px-6">
              <SegmentedFilter
                label="Billing view"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "subscriptions", label: "Subscriptions" },
                  { value: "payments", label: "Payments" },
                ]}
              />
            </div>
            {tab === "subscriptions" ? (
              <SubscriptionsTab state={state} filter={subFilter} onFilter={setSubFilter} />
            ) : (
              <PaymentsTab state={state} />
            )}
          </div>
        </Surface>
        <Surface title="This month" className="order-1 lg:order-2">
          <ul className="-my-3 divide-y divide-border">
            <SummaryRow
              label="Monthly recurring"
              value={formatCentavos(summary.monthlyRecurring)}
              note="Active and past due, yearly as a twelfth"
            />
            <SummaryRow
              label="Active"
              value={formatCount(summary.active)}
              onClick={() => show("active")}
            />
            <SummaryRow
              label="On trial"
              value={formatCount(summary.trialing)}
              onClick={() => show("trialing")}
            />
            <SummaryRow
              label="Past due"
              value={formatCount(summary.pastDue)}
              note="A payment failed"
              onClick={() => show("past_due")}
            />
            <SummaryRow
              label="Ending at period end"
              value={formatCount(summary.ending)}
              onClick={() => show("ending")}
            />
          </ul>
        </Surface>
      </div>
    </>
  );
}
