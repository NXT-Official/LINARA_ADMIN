import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FormDialog } from "@/components/shared/form";
import { SegmentedFilter } from "@/components/shared/list-toolbar";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/format";
import { fmtCentavos } from "@/lib/money";

import { CostDialog } from "../components/cost-dialog";
import { ModelPriceDialog } from "../components/model-price-dialog";
import { MoneyChartSurface } from "../components/money-chart";
import { deleteCostFn, getFinanceFn, listCostsFn, listModelPricesFn } from "../finance.actions";
import { FINANCE_KEYS } from "../finance-keys";
import {
  CATEGORY_LABEL,
  type AiByFn,
  type Cost,
  type Finance,
  type ModelPrice,
  type RangePreset,
} from "../finance.types";
import { monthHeading, rangeFor, seriesForChart } from "../finance.utils";

type Choice = RangePreset | "custom";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
  { value: "custom", label: "Custom" },
];

const money = (c: number | null) => (c === null ? "—" : fmtCentavos(c));

type Row = { label: string; value: string; definition: string };

function figureRows(f: Finance): Row[] {
  return [
    {
      label: "Revenue",
      value: money(f.revenueCentavos),
      definition: "Plan payments received in this range.",
    },
    {
      label: "COGS",
      value: money(f.cogsCentavos),
      definition: "What it cost to serve those households: AI use plus the costs you logged.",
    },
    {
      label: "of which AI",
      value: money(f.aiCostCentavos),
      definition: "AI calls priced from the model prices you set.",
    },
    {
      label: "AI calls",
      value: formatCount(f.aiCalls),
      definition: "Calls to the AI in this range.",
    },
    {
      label: "Cost per AI call",
      value: money(f.costPerCallCentavos),
      definition: "AI cost divided by AI calls. A dash means no calls yet.",
    },
    { label: "Profit", value: money(f.profitCentavos), definition: "Revenue minus COGS." },
    {
      label: "Paying households",
      value: formatCount(f.payingHouseholds),
      definition: "Covered by a paid plan at any point in the range (₱0 comps excluded).",
    },
    {
      label: "Users",
      value: formatCount(f.users),
      definition: "Distinct managers of those households.",
    },
    {
      label: "Profit per user",
      value: money(f.profitPerUserCentavos),
      definition: "Profit divided by users. A dash means no users yet.",
    },
  ];
}

type Failed = { isError: boolean; data?: { ok: boolean; message?: string } };

/** The reason a query gave nothing, or null while it is loading or fine. */
function failureOf(q: Failed): string | null {
  if (q.isError) return "Something went wrong on our side. Try again.";
  if (q.data && !q.data.ok) return q.data.message ?? "Something went wrong on our side.";
  return null;
}

function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Loading {what}
    </p>
  );
}

function Failure({
  title,
  reason,
  onRetry,
}: {
  title: string;
  reason: string | null;
  onRetry: () => void;
}) {
  return (
    <EmptyState title={title}>
      {reason}{" "}
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </EmptyState>
  );
}

function RangePicker({
  choice,
  from,
  to,
  error,
  onChoice,
  onFrom,
  onTo,
}: {
  choice: Choice;
  from: string;
  to: string;
  error: string | null;
  onChoice: (c: Choice) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="mb-6 space-y-3">
      <SegmentedFilter label="Date range" options={CHOICES} value={choice} onChange={onChoice} />
      {choice === "custom" ? (
        <div className="grid max-w-md gap-4 sm:grid-cols-2">
          <Field label="From" htmlFor="finance-from">
            <Input
              id="finance-from"
              type="date"
              value={from}
              onChange={(e) => onFrom(e.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="finance-to">
            <Input id="finance-to" type="date" value={to} onChange={(e) => onTo(e.target.value)} />
          </Field>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const AI_COLUMNS: Column<AiByFn>[] = [
  {
    key: "fn",
    header: "Function",
    mobile: "primary",
    cell: (r) => <span className="font-semibold text-foreground">{r.fn}</span>,
  },
  { key: "calls", header: "Calls", align: "right", cell: (r) => formatCount(r.calls) },
  { key: "cost", header: "Cost", align: "right", cell: (r) => fmtCentavos(r.costCentavos) },
  {
    key: "input",
    header: "Input tokens",
    align: "right",
    cell: (r) => formatCount(r.inputTokens),
  },
  {
    key: "output",
    header: "Output tokens",
    align: "right",
    cell: (r) => formatCount(r.outputTokens),
  },
];

function DeleteCostDialog({ cost }: { cost: Cost }) {
  const queryClient = useQueryClient();
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline" aria-label={`Delete ${cost.label}`}>
          Delete
        </Button>
      }
      title="Delete this cost"
      description={`"${cost.label}" (${fmtCentavos(cost.amountCentavos)}, ${monthHeading(cost.month)}) is removed and COGS and profit change with it.`}
      submitLabel="Delete cost"
      done="Cost deleted"
      destructive
      onSubmit={async () => {
        const res = await deleteCostFn({ data: { id: cost.id } });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: FINANCE_KEYS.all });
        return res;
      }}
    >
      {null}
    </FormDialog>
  );
}

function Costs({ from, to, enabled }: { from: string; to: string; enabled: boolean }) {
  const q = useQuery({
    queryKey: FINANCE_KEYS.costs(from, to),
    queryFn: () => listCostsFn({ data: { from, to } }),
    enabled,
  });
  const [editing, setEditing] = useState<Cost | null>(null);
  const failure = failureOf(q);
  const costs = q.data?.ok ? q.data.costs : null;

  const columns: Column<Cost>[] = [
    {
      key: "month",
      header: "Month",
      mobile: "primary",
      cell: (c) => <span className="font-semibold text-foreground">{monthHeading(c.month)}</span>,
    },
    {
      key: "label",
      header: "Cost",
      mobile: "primary",
      cell: (c) => (
        <span>
          {c.label}
          {c.note ? <span className="block text-xs text-muted-foreground">{c.note}</span> : null}
        </span>
      ),
    },
    { key: "category", header: "Category", cell: (c) => CATEGORY_LABEL[c.category] },
    { key: "amount", header: "Amount", align: "right", cell: (c) => fmtCentavos(c.amountCentavos) },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-48",
      cell: (c) => (
        <span className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label={`Edit ${c.label}`}
            onClick={() => setEditing(c)}
          >
            Edit
          </Button>
          <DeleteCostDialog cost={c} />
        </span>
      ),
    },
  ];

  return (
    <>
      <Surface
        title="Costs"
        description="What you pay to run Linara, counted in the month you log it. Months in the range above."
        flush
        actions={
          <CostDialog
            cost={null}
            trigger={
              <Button size="sm">
                <Plus />
                Add cost
              </Button>
            }
          />
        }
      >
        {failure ? (
          <div className="px-5 pb-6 pt-2 sm:px-6">
            <Failure
              title="The costs didn't load"
              reason={failure}
              onRetry={() => void q.refetch()}
            />
          </div>
        ) : costs ? (
          <DataTable
            label="Costs"
            rows={costs}
            rowKey={(c) => c.id}
            columns={columns}
            empty={
              <EmptyState title="No costs logged in this range">
                Add hosting, AI subscriptions or payment fees so profit is honest.
              </EmptyState>
            }
          />
        ) : (
          <div className="px-5 pb-6 pt-2 sm:px-6">
            <Loading what="costs" />
          </div>
        )}
      </Surface>
      {editing ? (
        <CostDialog
          key={editing.id}
          cost={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function ModelPrices() {
  const q = useQuery({ queryKey: FINANCE_KEYS.prices, queryFn: () => listModelPricesFn() });
  const [editing, setEditing] = useState<ModelPrice | null>(null);
  const failure = failureOf(q);
  const prices = q.data?.ok ? q.data.prices : null;

  const columns: Column<ModelPrice>[] = [
    {
      key: "model",
      header: "Model",
      mobile: "primary",
      cell: (p) => (
        <span>
          <span className="font-semibold text-foreground">{p.model}</span>
          {p.note ? <span className="block text-xs text-muted-foreground">{p.note}</span> : null}
        </span>
      ),
    },
    {
      key: "input",
      header: "Input per 1M tokens",
      align: "right",
      cell: (p) => fmtCentavos(p.inputCentavosPer1m),
    },
    {
      key: "output",
      header: "Output per 1M tokens",
      align: "right",
      cell: (p) => fmtCentavos(p.outputCentavosPer1m),
    },
    {
      key: "audio",
      header: "Audio per minute",
      align: "right",
      cell: (p) => fmtCentavos(p.audioCentavosPerMinute),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-24",
      cell: (p) => (
        <Button
          size="sm"
          variant="outline"
          aria-label={`Edit ${p.model}`}
          onClick={() => setEditing(p)}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <Surface
        title="Model prices"
        description="What each AI model costs. AI calls are priced from these when they are made."
        flush
        actions={
          <ModelPriceDialog
            price={null}
            trigger={
              <Button size="sm" variant="outline">
                <Plus />
                Add model
              </Button>
            }
          />
        }
      >
        {failure ? (
          <div className="px-5 pb-6 pt-2 sm:px-6">
            <Failure
              title="The model prices didn't load"
              reason={failure}
              onRetry={() => void q.refetch()}
            />
          </div>
        ) : prices ? (
          <DataTable
            label="Model prices"
            rows={prices}
            rowKey={(p) => p.model}
            columns={columns}
            empty={
              <EmptyState title="No model prices yet">
                Until a model has a price, its calls cost ₱0.00 in the figures.
              </EmptyState>
            }
          />
        ) : (
          <div className="px-5 pb-6 pt-2 sm:px-6">
            <Loading what="model prices" />
          </div>
        )}
      </Surface>
      {editing ? (
        <ModelPriceDialog
          key={editing.model}
          price={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Finance: money in, money out, what the AI costs, and the prices behind it. No CSV export (FR-EX-1). */
export function FinancePage() {
  const initial = useMemo(() => rangeFor("this_month", new Date()), []);
  const [choice, setChoice] = useState<Choice>("this_month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const rangeError =
    !from || !to ? "Pick both dates." : from > to ? "Start must be on or before the end." : null;
  const enabled = rangeError === null;

  const figures = useQuery({
    queryKey: FINANCE_KEYS.figures(from, to),
    queryFn: () => getFinanceFn({ data: { from, to } }),
    enabled,
  });

  function pick(next: Choice) {
    setChoice(next);
    if (next !== "custom") {
      const r = rangeFor(next, new Date());
      setFrom(r.from);
      setTo(r.to);
    }
  }

  const failure = failureOf(figures);
  const finance = figures.data?.ok ? figures.data.finance : null;
  const retry = () => void figures.refetch();

  return (
    <>
      <PageHeader
        title="Finance"
        description="What came in, what it cost to serve, and what is left. All amounts in pesos."
      />
      <RangePicker
        choice={choice}
        from={from}
        to={to}
        error={rangeError}
        onChoice={pick}
        onFrom={setFrom}
        onTo={setTo}
      />
      <div className="space-y-6">
        <Surface title="Figures">
          {failure ? (
            <Failure title="Finance figures didn't load" reason={failure} onRetry={retry} />
          ) : finance ? (
            <DetailList
              items={figureRows(finance).map((r) => ({
                label: r.label,
                value: (
                  <>
                    <span className="block text-base font-semibold tabular-nums">{r.value}</span>
                    <span className="block text-sm text-muted-foreground">{r.definition}</span>
                  </>
                ),
              }))}
            />
          ) : enabled ? (
            <Loading what="figures" />
          ) : (
            <p className="text-sm text-muted-foreground">Fix the dates to see figures.</p>
          )}
        </Surface>

        {finance ? (
          finance.series.length > 0 ? (
            <MoneyChartSurface
              title="Revenue, COGS and profit"
              description="By month. Profit is revenue minus COGS and can go below zero."
              data={seriesForChart(finance)}
            />
          ) : (
            <Surface title="Revenue, COGS and profit">
              <EmptyState title="Nothing to chart yet">
                No payments, costs or AI calls fall in this range.
              </EmptyState>
            </Surface>
          )
        ) : failure ? (
          <Surface title="Revenue, COGS and profit">
            <Failure title="Finance figures didn't load" reason={failure} onRetry={retry} />
          </Surface>
        ) : null}

        <Surface
          title="AI by function"
          description="Calls and cost for each part of Linara that uses the AI."
          flush
        >
          {failure ? (
            <div className="px-5 pb-6 pt-2 sm:px-6">
              <Failure title="Finance figures didn't load" reason={failure} onRetry={retry} />
            </div>
          ) : finance ? (
            <DataTable
              label="AI by function"
              rows={finance.aiByFn}
              rowKey={(r) => r.fn}
              columns={AI_COLUMNS}
              empty={
                <EmptyState title="No AI calls in this range">
                  Calls appear here once households use an AI feature.
                </EmptyState>
              }
            />
          ) : (
            <div className="px-5 pb-6 pt-2 sm:px-6">
              <Loading what="AI use" />
            </div>
          )}
        </Surface>

        <Costs from={from} to={to} enabled={enabled} />
        <ModelPrices />
      </div>
    </>
  );
}
