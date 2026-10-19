import { useMemo, useReducer, useState } from "react";

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
import { formatCount, formatDate, formatPeso } from "@/lib/format";

import { billingReducer, summarize, type BillingAction } from "../billing.logic";
import { PLANS, SAMPLE_BILLING, planById } from "../billing.sample";
import {
  PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
  type BillingState,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  type PlanId,
  type Subscription,
  type SubscriptionStatus,
} from "../billing.types";

type Tab = "subscriptions" | "payments" | "plans";
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

function priceLabel(planId: PlanId) {
  const plan = planById(planId);
  if (!plan.interval) return "Free";
  return `${formatPeso(plan.price)} a ${plan.interval}`;
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

function ChangePlanDialog({
  sub,
  dispatch,
}: {
  sub: Subscription;
  dispatch: (a: BillingAction) => void;
}) {
  const [planId, setPlanId] = useState<PlanId>(sub.planId);
  return (
    <FormDialog
      trigger={<Button variant="outline">Change plan</Button>}
      title="Change plan"
      description={`${sub.householdName}. The new plan starts today. ${SAMPLE_NOTE}`}
      submitLabel="Change plan"
      done={`Plan changed. ${SAMPLE_NOTE}`}
      canSubmit={planId !== sub.planId}
      onSubmit={async () => {
        dispatch({ type: "change_plan", subscriptionId: sub.id, planId });
        return { ok: true };
      }}
    >
      {(id) => (
        <Field label="Plan" htmlFor={id("plan")}>
          <SelectField
            id={id("plan")}
            value={planId}
            onChange={setPlanId}
            options={PLANS.map((p) => ({ value: p.id, label: `${p.name}, ${priceLabel(p.id)}` }))}
          />
        </Field>
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
  onConfirm: () => void;
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
      onSubmit={async () => {
        onConfirm();
        return { ok: true };
      }}
    >
      {null}
    </FormDialog>
  );
}

function PaymentActions({
  payment,
  dispatch,
}: {
  payment: Payment;
  dispatch: (a: BillingAction) => void;
}) {
  if (payment.status === "failed") {
    return (
      <ConfirmAction
        label="Retry payment"
        title="Retry this payment"
        description={`Charge ${formatPeso(payment.amount)} to ${methodLabel(payment.method)} again.`}
        done="Payment retried and paid."
        onConfirm={() => dispatch({ type: "retry_payment", paymentId: payment.id })}
      />
    );
  }
  if (payment.status === "paid" && payment.amount > 0) {
    return (
      <ConfirmAction
        label="Refund"
        title="Refund this payment"
        description={`Return ${formatPeso(payment.amount)} to ${methodLabel(payment.method)}.`}
        done="Payment refunded."
        destructive
        onConfirm={() => dispatch({ type: "refund_payment", paymentId: payment.id })}
      />
    );
  }
  return null;
}

function SubscriptionDialog({
  sub,
  payments,
  dispatch,
  onClose,
}: {
  sub: Subscription;
  payments: Payment[];
  dispatch: (a: BillingAction) => void;
  onClose: () => void;
}) {
  const paying = sub.planId !== "free" && sub.status !== "cancelled";
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
            { label: "Plan", value: `${planById(sub.planId).name}, ${priceLabel(sub.planId)}` },
            { label: "Status", value: <SubStatus sub={sub} /> },
            { label: "Period", value: periodLabel(sub) },
            { label: "Subscribed since", value: formatDate(sub.startedAt) },
            { label: "Pays with", value: methodLabel(sub.method) },
          ]}
        />
        <div className="flex flex-wrap gap-2 pt-2">
          <ChangePlanDialog sub={sub} dispatch={dispatch} />
          {paying && !sub.cancelAtPeriodEnd ? (
            <ConfirmAction
              label="Cancel at period end"
              title="Cancel at the period's end"
              description={`Premium stays on until ${sub.periodEnd ? formatDate(sub.periodEnd) : "the period ends"}, then the household moves to Free.`}
              done="Set to end at the period's end."
              destructive
              onConfirm={() => dispatch({ type: "cancel_at_period_end", subscriptionId: sub.id })}
            />
          ) : null}
          {paying && sub.cancelAtPeriodEnd ? (
            <ConfirmAction
              label="Keep subscription"
              title="Keep this subscription"
              description="It renews as usual at the period's end."
              done="Subscription kept."
              onConfirm={() => dispatch({ type: "resume", subscriptionId: sub.id })}
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
                    <span className="font-semibold text-foreground">{formatPeso(p.amount)}</span>{" "}
                    <span className="text-muted-foreground">
                      {formatDate(p.createdAt)}, {p.reference}
                    </span>
                    {p.failureReason ? (
                      <div className="text-xs text-muted-foreground">{p.failureReason}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip tone={PAYMENT_TONE[p.status]}>{PAYMENT_LABEL[p.status]}</StatusChip>
                    <PaymentActions payment={p} dispatch={dispatch} />
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
  dispatch,
  filter,
  onFilter,
}: {
  state: BillingState;
  dispatch: (a: BillingAction) => void;
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
          <button type="button" className={rowLinkClass} onClick={() => setOpenId(s.id)}>
            {s.householdName}
          </button>
          <div className="text-xs text-muted-foreground">Paid by {s.payerName}</div>
        </div>
      ),
    },
    { key: "plan", header: "Plan", cell: (s) => planById(s.planId).name },
    { key: "status", header: "Status", mobile: "primary", cell: (s) => <SubStatus sub={s} /> },
    {
      key: "period",
      header: "Period",
      cell: (s) => <span className="whitespace-nowrap">{periodLabel(s)}</span>,
    },
    { key: "method", header: "Pays with", mobile: "hidden", cell: (s) => methodLabel(s.method) },
    { key: "price", header: "Price", align: "right", cell: (s) => priceLabel(s.planId) },
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
        <SubscriptionDialog
          sub={open}
          payments={state.payments.filter((p) => p.subscriptionId === open.id)}
          dispatch={dispatch}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function PaymentsTab({
  state,
  dispatch,
}: {
  state: BillingState;
  dispatch: (a: BillingAction) => void;
}) {
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
    { key: "amount", header: "Amount", align: "right", cell: (p) => formatPeso(p.amount) },
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
    { key: "actions", header: "", cell: (p) => <PaymentActions payment={p} dispatch={dispatch} /> },
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

function PlansTab({ state }: { state: BillingState }) {
  const columns: Column<(typeof PLANS)[number]>[] = [
    {
      key: "name",
      header: "Plan",
      mobile: "primary",
      cell: (p) => <span className="font-semibold text-foreground">{p.name}</span>,
    },
    { key: "price", header: "Price", mobile: "primary", cell: (p) => priceLabel(p.id) },
    {
      key: "includes",
      header: "Includes",
      className: "max-w-96",
      cell: (p) => p.includes.join(", "),
    },
    {
      key: "households",
      header: "Households",
      align: "right",
      cell: (p) =>
        formatCount(
          state.subscriptions.filter((s) => s.planId === p.id && s.status !== "cancelled").length,
        ),
    },
  ];
  return (
    <>
      <DataTable label="Plans" rows={PLANS} columns={columns} rowKey={(p) => p.id} empty={null} />
      <p className="px-5 pb-5 text-xs text-muted-foreground sm:px-6">
        Placeholder prices. Helpers never pay; the household's manager does.
      </p>
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
      <span className="text-xl font-semibold text-foreground">{value}</span>
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

/** Subscriptions screen, a preview on sample data held in the browser (D40). */
export function BillingPage() {
  const [state, rawDispatch] = useReducer(
    (s: BillingState, a: BillingAction | "reset") =>
      a === "reset" ? SAMPLE_BILLING : billingReducer(s, a),
    SAMPLE_BILLING,
  );
  const dispatch = (a: BillingAction) => rawDispatch(a);
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
        description="Plans, subscriptions and payments for households. This is a preview on sample data: Linara has no billing yet, so nothing here charges, refunds or saves."
        actions={
          <>
            <StatusChip tone="attention" className="self-center">
              Sample data
            </StatusChip>
            <Button variant="outline" onClick={() => rawDispatch("reset")}>
              Reset sample
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
                  { value: "plans", label: "Plans" },
                ]}
              />
            </div>
            {tab === "subscriptions" ? (
              <SubscriptionsTab
                state={state}
                dispatch={dispatch}
                filter={subFilter}
                onFilter={setSubFilter}
              />
            ) : tab === "payments" ? (
              <PaymentsTab state={state} dispatch={dispatch} />
            ) : (
              <PlansTab state={state} />
            )}
          </div>
        </Surface>
        <Surface title="This month" className="order-1 lg:order-2">
          <ul className="-my-3 divide-y divide-border">
            <SummaryRow
              label="Monthly recurring"
              value={formatPeso(summary.monthlyRecurring)}
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
