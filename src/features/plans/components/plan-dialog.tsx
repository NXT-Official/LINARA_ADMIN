import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtCentavos, pesosToCentavos } from "@/lib/money";

import { savePlanFn } from "../plans.actions";
import { quoteAmount } from "../plans.pricing";
import { PLAN_KEYS } from "../plans-keys";
import type { Plan, PlanInput, PlanInterval } from "../plans.types";

const PREVIEW_SEATS = { helpers: 2, managers: 1, homes: 1 };
const INTERVALS: { value: PlanInterval; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "one_time", label: "One-time" },
];
const PESOS_ERROR = "Use pesos with up to two decimals";
const WHOLE_ERROR = "Whole seats, zero or more.";

type Dim = "helper" | "manager" | "home";
const DIMS: { dim: Dim; plural: string }[] = [
  { dim: "helper", plural: "helpers" },
  { dim: "manager", plural: "managers" },
  { dim: "home", plural: "homes" },
];

type Form = {
  name: string;
  tagline: string;
  inclusions: string;
  interval: PlanInterval;
  base: string;
  trialDays: string;
  sortOrder: string;
  isPublic: boolean;
  included: Record<Dim, { unlimited: boolean; value: string }>;
  extra: Record<Dim, { notSold: boolean; value: string }>;
};

const pesosText = (centavos: number) => (centavos / 100).toFixed(2);

function toForm(plan: Plan | null): Form {
  if (!plan) {
    return {
      name: "",
      tagline: "",
      inclusions: "",
      interval: "monthly",
      base: "",
      trialDays: "0",
      sortOrder: "0",
      isPublic: true,
      included: {
        helper: { unlimited: false, value: "1" },
        manager: { unlimited: false, value: "1" },
        home: { unlimited: true, value: "" },
      },
      extra: {
        helper: { notSold: true, value: "" },
        manager: { notSold: true, value: "" },
        home: { notSold: true, value: "" },
      },
    };
  }
  const inc = (n: number | null) => ({ unlimited: n === null, value: n === null ? "" : String(n) });
  const ext = (c: number | null) => ({
    notSold: c === null,
    value: c === null ? "" : pesosText(c),
  });
  return {
    name: plan.name,
    tagline: plan.tagline,
    inclusions: plan.inclusions.join("\n"),
    interval: plan.interval,
    base: pesosText(plan.baseCentavos),
    trialDays: String(plan.trialDays),
    sortOrder: String(plan.sortOrder),
    isPublic: plan.isPublic,
    included: {
      helper: inc(plan.includedHelpers),
      manager: inc(plan.includedManagers),
      home: inc(plan.includedHomes),
    },
    extra: {
      helper: ext(plan.extraHelperCentavos),
      manager: ext(plan.extraManagerCentavos),
      home: ext(plan.extraHomeCentavos),
    },
  };
}

/** A non-negative whole number from text, or null when it isn't one. */
function parseWhole(text: string): number | null {
  if (!/^[0-9]+$/.test(text.trim())) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

type Built = { input: PlanInput; errors: Record<string, string> };

/** Reads the form into a plan; `errors` is empty when the plan can be saved. */
function build(form: Form, existing: Plan | null): Built {
  const errors: Record<string, string> = {};
  const name = form.name.trim();
  if (name === "") errors.name = "Give the plan a name.";
  else if (name.length > 60) errors.name = "Keep the name to 60 characters.";

  const base = pesosToCentavos(form.base);
  if (base === null) errors.base = PESOS_ERROR;

  const trial = parseWhole(form.trialDays);
  if (trial === null) errors.trialDays = "Whole days, zero or more.";

  const sort = parseWhole(form.sortOrder);
  if (sort === null) errors.sortOrder = "A whole number, zero or more.";

  const included = {} as Record<Dim, number | null>;
  const extra = {} as Record<Dim, number | null>;
  for (const { dim } of DIMS) {
    const inc = form.included[dim];
    if (inc.unlimited) included[dim] = null;
    else {
      const n = parseWhole(inc.value);
      if (n === null) errors[`included-${dim}`] = WHOLE_ERROR;
      included[dim] = n;
    }
    const ex = form.extra[dim];
    if (ex.notSold || inc.unlimited) extra[dim] = null;
    else {
      const n = pesosToCentavos(ex.value);
      if (n === null) errors[`extra-${dim}`] = PESOS_ERROR;
      extra[dim] = n;
    }
  }

  const input: PlanInput = {
    ...(existing ? { id: existing.id } : {}),
    name,
    tagline: form.tagline.trim(),
    inclusions: form.inclusions
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
    interval: form.interval,
    baseCentavos: base ?? 0,
    includedHelpers: included.helper,
    includedManagers: included.manager,
    includedHomes: included.home,
    extraHelperCentavos: extra.helper,
    extraManagerCentavos: extra.manager,
    extraHomeCentavos: extra.home,
    trialDays: trial ?? 0,
    isPublic: form.isPublic,
    sortOrder: sort ?? 0,
  };
  return { input, errors };
}

function previewText(input: PlanInput, existing: Plan | null): string {
  const quote = quoteAmount(
    { ...input, id: existing?.id ?? "", status: existing?.status ?? "draft" },
    PREVIEW_SEATS,
  );
  const who = "A household with 2 helpers, 1 manager, 1 home";
  if (quote.ok) return `${who} pays ${fmtCentavos(quote.amountCentavos)}.`;
  return `${who} can't buy this plan: there is no price for extra ${quote.over}s.`;
}

const checkCls = "h-4 w-4 accent-primary";

const Problem = ({ children }: { children?: string }) =>
  children ? <span className="text-destructive">{children}</span> : null;

/**
 * Creating or replacing a plan. Prices are typed in pesos and sent as centavos;
 * a status (draft, active, archived) is never set here, only by the row's
 * Publish, Unpublish, Archive and Restore actions. Mount it only while it is
 * open so each opening starts from the plan as saved.
 */
export function PlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setIncluded = (dim: Dim, patch: Partial<Form["included"][Dim]>) =>
    setForm((f) => ({
      ...f,
      included: { ...f.included, [dim]: { ...f.included[dim], ...patch } },
    }));
  const setExtra = (dim: Dim, patch: Partial<Form["extra"][Dim]>) =>
    setForm((f) => ({ ...f, extra: { ...f.extra, [dim]: { ...f.extra[dim], ...patch } } }));

  const built = build(form, plan);
  const previewable = Object.keys(built.errors).length === 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? `Edit ${plan.name}` : "New plan"}
      description="Prices are final, in pesos, with tax included."
      submitLabel={plan ? "Save plan" : "Create plan"}
      done={plan ? "Plan saved" : "Plan created"}
      onSubmit={async () => {
        const { input, errors: found } = build(form, plan);
        setErrors(found);
        if (Object.keys(found).length > 0) {
          return { ok: false as const, message: "Fix the highlighted fields." };
        }
        const res = await savePlanFn({ data: input });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: PLAN_KEYS.plans });
        return res;
      }}
    >
      {(id) => (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <Field label="Name" htmlFor={id("name")} hint={<Problem>{errors.name}</Problem>}>
            <Input
              id={id("name")}
              autoComplete="off"
              maxLength={60}
              value={form.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Tagline" htmlFor={id("tagline")}>
            <Input
              id={id("tagline")}
              autoComplete="off"
              maxLength={200}
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
            />
          </Field>
          <Field label="What is included (one per line)" htmlFor={id("inclusions")}>
            <Textarea
              id={id("inclusions")}
              rows={4}
              value={form.inclusions}
              onChange={(e) => set("inclusions", e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Billing" htmlFor={id("interval")}>
              <SelectField
                id={id("interval")}
                value={form.interval}
                onChange={(v) => set("interval", v)}
                options={INTERVALS}
              />
            </Field>
            <Field
              label="Base price (pesos)"
              htmlFor={id("base")}
              hint={<Problem>{errors.base}</Problem>}
            >
              <Input
                id={id("base")}
                inputMode="decimal"
                autoComplete="off"
                value={form.base}
                aria-invalid={Boolean(errors.base)}
                onChange={(e) => set("base", e.target.value)}
              />
            </Field>
            <Field
              label="Free trial (days)"
              htmlFor={id("trial")}
              hint={<Problem>{errors.trialDays}</Problem>}
            >
              <Input
                id={id("trial")}
                inputMode="numeric"
                autoComplete="off"
                value={form.trialDays}
                aria-invalid={Boolean(errors.trialDays)}
                onChange={(e) => set("trialDays", e.target.value)}
              />
            </Field>
            <Field
              label="Order on the pricing page"
              htmlFor={id("sort")}
              hint={<Problem>{errors.sortOrder}</Problem>}
            >
              <Input
                id={id("sort")}
                inputMode="numeric"
                autoComplete="off"
                value={form.sortOrder}
                aria-invalid={Boolean(errors.sortOrder)}
                onChange={(e) => set("sortOrder", e.target.value)}
              />
            </Field>
          </div>

          <div className="divide-y divide-border rounded-2xl border border-border">
            {DIMS.map(({ dim, plural }) => {
              const inc = form.included[dim];
              const ex = form.extra[dim];
              return (
                <div key={dim} className="grid items-end gap-3 p-4 sm:grid-cols-2">
                  <Field
                    label={`Included ${plural}`}
                    htmlFor={id(`inc-${dim}`)}
                    hint={<Problem>{errors[`included-${dim}`]}</Problem>}
                  >
                    <Input
                      id={id(`inc-${dim}`)}
                      inputMode="numeric"
                      autoComplete="off"
                      value={inc.value}
                      disabled={inc.unlimited}
                      aria-invalid={Boolean(errors[`included-${dim}`])}
                      onChange={(e) => setIncluded(dim, { value: e.target.value })}
                    />
                  </Field>
                  <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className={checkCls}
                      checked={inc.unlimited}
                      onChange={(e) => setIncluded(dim, { unlimited: e.target.checked })}
                    />
                    Unlimited {plural}
                  </label>
                  <Field
                    label={`Price per extra ${dim} (pesos)`}
                    htmlFor={id(`ext-${dim}`)}
                    hint={<Problem>{errors[`extra-${dim}`]}</Problem>}
                  >
                    <Input
                      id={id(`ext-${dim}`)}
                      inputMode="decimal"
                      autoComplete="off"
                      value={ex.value}
                      disabled={ex.notSold || inc.unlimited}
                      aria-invalid={Boolean(errors[`extra-${dim}`])}
                      onChange={(e) => setExtra(dim, { value: e.target.value })}
                    />
                  </Field>
                  <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className={checkCls}
                      checked={ex.notSold || inc.unlimited}
                      disabled={inc.unlimited}
                      onChange={(e) => setExtra(dim, { notSold: e.target.checked })}
                    />
                    Extra {plural} not sold
                  </label>
                </div>
              );
            })}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className={checkCls}
              checked={form.isPublic}
              onChange={(e) => set("isPublic", e.target.checked)}
            />
            Show on the public pricing page once active
          </label>

          <p role="status" className="rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground">
            {previewable
              ? previewText(built.input, plan)
              : "Fix the highlighted fields to see a price."}
          </p>
        </div>
      )}
    </FormDialog>
  );
}
