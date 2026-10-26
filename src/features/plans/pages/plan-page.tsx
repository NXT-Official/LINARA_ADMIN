import { useId, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Field, FormDialog } from "@/components/shared/form";
import { BackLink, RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCount, formatDate, plural } from "@/lib/format";
import { sampleToast } from "@/lib/sample-toast";
import { cn } from "@/lib/utils";

import { SAMPLE_NOTE, SampleActions } from "../components/sample-bar";
import {
  centavosToInput,
  currentVersion,
  CYCLE_LABEL,
  featureOffForEveryone,
  householdsOn,
  isVersioned,
  MAX_DESCRIPTION,
  parsePeso,
  PLAN_TONE,
  priceSummary,
  sameContent,
  STATUS_LABEL,
  statusMoves,
  validateContent,
  type ContentErrors,
} from "../plans.logic";
import { FEATURES, LIMIT_LABEL } from "../plans.sample";
import { dispatchCatalog, useCatalog } from "../plans.store";
import {
  CYCLES,
  LIMIT_KEYS,
  type Cycle,
  type LimitKey,
  type Plan,
  type PlanContent,
  type PlanStatus,
} from "../plans.types";

/** The form as typed. Numbers stay text until they're read, so a half-typed price isn't lost. */
type FormState = {
  name: string;
  description: string;
  trialDays: string;
  prices: Record<Cycle, { on: boolean; text: string }>;
  features: PlanContent["features"];
  limits: Record<LimitKey, { unlimited: boolean; text: string }>;
};

function toForm(c: PlanContent): FormState {
  return {
    name: c.name,
    description: c.description,
    trialDays: String(c.trialDays),
    prices: Object.fromEntries(
      CYCLES.map((cy) => [cy, { on: c.prices[cy] !== null, text: centavosToInput(c.prices[cy]) }]),
    ) as FormState["prices"],
    features: { ...c.features },
    limits: Object.fromEntries(
      LIMIT_KEYS.map((k) => [
        k,
        { unlimited: c.limits[k] === null, text: c.limits[k] === null ? "" : String(c.limits[k]) },
      ]),
    ) as FormState["limits"],
  };
}

const WHOLE = /^\d{1,3}$/;
const INVALID =
  "border-destructive focus-visible:border-destructive focus-visible:ring-destructive";

/** The form read back into plan content, with what couldn't be read. */
function fromForm(f: FormState): { content: PlanContent; errors: ContentErrors } {
  const errors: ContentErrors = {};
  const prices = {} as PlanContent["prices"];
  for (const cy of CYCLES) {
    const p = f.prices[cy];
    if (!p.on) {
      prices[cy] = null;
      continue;
    }
    const parsed = parsePeso(p.text);
    if (parsed.ok) prices[cy] = parsed.centavos;
    else {
      prices[cy] = 0;
      errors[cy] = parsed.message;
    }
  }
  const limits = {} as PlanContent["limits"];
  for (const k of LIMIT_KEYS) {
    const l = f.limits[k];
    if (l.unlimited) limits[k] = null;
    else if (WHOLE.test(l.text.trim())) limits[k] = Number(l.text.trim());
    else {
      limits[k] = Number.NaN;
      errors[k] = "Enter a whole number, or choose unlimited.";
    }
  }
  const trial = f.trialDays.trim();
  return {
    content: {
      name: f.name,
      description: f.description.trim(),
      prices,
      trialDays: WHOLE.test(trial) ? Number(trial) : Number.NaN,
      features: f.features,
      limits,
    },
    errors,
  };
}

function Checkbox({
  checked,
  onChange,
  disabled,
  label,
  description,
  extra,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
  extra?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start gap-3 py-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-pine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-foreground">
          {label}
        </label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {extra ? <div className="shrink-0">{extra}</div> : null}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs font-semibold text-destructive">
      {children}
    </p>
  );
}

const keeps = (n: number) => (n === 1 ? "keeps" : "keep");

const MOVE_COPY: Record<PlanStatus, (p: Plan, households: number) => string> = {
  published: (p) =>
    isVersioned(p)
      ? "New households can choose it again at sign-up."
      : `New households can sign up to it at ${priceSummary(p.content)}. This makes version 1.`,
  hidden: (_p, n) =>
    `Nobody new can choose it. The ${plural(n, "household")} on it ${keeps(n)} it.`,
  retired: (_p, n) =>
    `Nobody new can choose it, and it can't be changed or published again. The ${plural(n, "household")} on it ${keeps(n)} it until they change plans.`,
  draft: () => "",
};

function PublishingPanel({
  plan,
  dirty,
  households,
}: {
  plan: Plan;
  dirty: boolean;
  households: number;
}) {
  const navigate = useNavigate();
  const moves = statusMoves(plan);
  const deletable = plan.status === "draft" && !isVersioned(plan) && households === 0;
  return (
    <Surface title="Publishing">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={PLAN_TONE[plan.status]}>{STATUS_LABEL[plan.status]}</StatusChip>
          <span className="text-sm text-muted-foreground">
            {isVersioned(plan) ? `Version ${currentVersion(plan)}` : "Never published"}
          </span>
        </div>
        <p className="text-sm text-foreground">
          <span className="tabular-nums">{formatCount(households)}</span>{" "}
          {households === 1 ? "household is" : "households are"} on this plan.
        </p>
        {plan.status === "retired" ? (
          <p className="text-sm text-muted-foreground">
            Retired plans stay for the households still on them, and can't be edited.
          </p>
        ) : null}
        {dirty && moves.length ? (
          <p className="text-xs text-muted-foreground">Save or discard your changes first.</p>
        ) : null}
        {moves.length || deletable ? (
          <div className="flex flex-wrap gap-2">
            {moves.map((m) => (
              <FormDialog
                key={m.to}
                trigger={
                  <Button
                    variant={
                      m.to === "published"
                        ? "default"
                        : m.to === "retired"
                          ? "destructive"
                          : "outline"
                    }
                    disabled={dirty}
                  >
                    {m.label}
                  </Button>
                }
                title={`${m.label}: ${plan.content.name}`}
                description={`${MOVE_COPY[m.to](plan, households)} ${SAMPLE_NOTE}`}
                submitLabel={m.label}
                done={`${plan.content.name} is now ${STATUS_LABEL[m.to].toLowerCase()}. ${SAMPLE_NOTE}`}
                destructive={m.to === "retired"}
                onSubmit={async () =>
                  dispatchCatalog({ type: "set_status", planId: plan.id, status: m.to })
                }
              >
                {null}
              </FormDialog>
            ))}
            {deletable ? (
              <FormDialog
                trigger={
                  <Button variant="ghost" disabled={dirty}>
                    Delete draft
                  </Button>
                }
                title={`Delete ${plan.content.name}`}
                description={`It was never published, so nobody is on it. ${SAMPLE_NOTE}`}
                submitLabel="Delete draft"
                done={`Draft deleted. ${SAMPLE_NOTE}`}
                destructive
                onSubmit={async () => {
                  const res = dispatchCatalog({ type: "delete_plan", planId: plan.id });
                  if (res.ok) void navigate({ to: "/plans" });
                  return res;
                }}
              >
                {null}
              </FormDialog>
            ) : null}
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function VersionsPanel({ plan }: { plan: Plan }) {
  return (
    <Surface title="Versions">
      {plan.versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Not published yet. Publishing makes version 1; each saved change after that is a new
          version.
        </p>
      ) : (
        <ol className="-my-2.5 divide-y divide-border">
          {plan.versions.map((v) => (
            <li key={v.version} className="py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Version {v.version}</span>
                <span className="text-xs text-muted-foreground">{formatDate(v.savedAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {v.summary}, by {v.savedBy}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Surface>
  );
}

function PlanEditor({ plan }: { plan: Plan }) {
  const state = useCatalog();
  const base = useId();
  const id = (n: string) => `${base}-${n}`;
  const [form, setForm] = useState<FormState>(() => toForm(plan.content));
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (change: Partial<FormState>) => {
    setSaveError(null);
    setForm((f) => ({ ...f, ...change }));
  };

  const others = state.plans.filter((p) => p.id !== plan.id);
  const live = plan.status === "published" || plan.status === "hidden";
  const { content, errors: readErrors } = fromForm(form);
  const errors: ContentErrors = {
    ...validateContent(content, others, { forPublish: live }),
    ...readErrors,
  };
  const valid = Object.keys(errors).length === 0;
  const dirty = !sameContent(plan.content, { ...content, name: content.name.trim() });
  const locked = plan.status === "retired";
  const nextVersion = currentVersion(plan) + 1;
  const households = householdsOn(state, plan.id);
  const onCurrent = householdsOn(state, plan.id, currentVersion(plan));

  function save() {
    const res = dispatchCatalog({ type: "save_plan", planId: plan.id, content });
    if (!res.ok) {
      setSaveError(res.message);
      return;
    }
    sampleToast(isVersioned(plan) ? `Saved as version ${nextVersion}.` : "Draft saved.");
  }

  // Spread last on an input: it sets the input's whole className.
  const errorFor = (key: keyof ContentErrors, className?: string) => ({
    className: cn(className, errors[key] && INVALID),
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? id(`${key}-error`) : undefined,
  });

  return (
    <>
      <PageHeader
        back={<BackLink to="/plans">Plans</BackLink>}
        title={plan.content.name}
        description={priceSummary(plan.content)}
        actions={<SampleActions />}
      />
      <div className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-6">
          <Surface title="Details">
            <fieldset disabled={locked} className="space-y-4">
              <Field label="Name" htmlFor={id("name")}>
                <Input
                  id={id("name")}
                  value={form.name}
                  autoComplete="off"
                  onChange={(e) => set({ name: e.target.value })}
                  {...errorFor("name")}
                />
                <FieldError id={id("name-error")}>{errors.name}</FieldError>
              </Field>
              <Field
                label="Description"
                htmlFor={id("description")}
                hint={`What the plan is for, in one line. ${[...form.description].length} of ${MAX_DESCRIPTION}.`}
              >
                <Textarea
                  id={id("description")}
                  value={form.description}
                  rows={2}
                  onChange={(e) => set({ description: e.target.value })}
                  {...errorFor("description")}
                />
                <FieldError id={id("description-error")}>{errors.description}</FieldError>
              </Field>
              <Field
                label="Free trial, in days"
                htmlFor={id("trial")}
                hint="0 for no trial. New subscribers only."
              >
                <Input
                  id={id("trial")}
                  inputMode="numeric"
                  value={form.trialDays}
                  onChange={(e) => set({ trialDays: e.target.value })}
                  {...errorFor("trialDays", "max-w-32")}
                />
                <FieldError id={id("trialDays-error")}>{errors.trialDays}</FieldError>
              </Field>
            </fieldset>
          </Surface>

          <Surface
            title="Prices"
            description={
              plan.pricePlaceholder
                ? "In pesos. These are placeholder prices until marketing sets the real ones."
                : "In pesos. Tick each way the plan is sold; a free plan is ₱0 a month."
            }
          >
            <fieldset disabled={locked} className="divide-y divide-border">
              <legend className="sr-only">Prices</legend>
              {CYCLES.map((cy) => {
                const p = form.prices[cy];
                return (
                  <div
                    key={cy}
                    className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,14rem)] sm:items-start"
                  >
                    <Checkbox
                      checked={p.on}
                      label={`Sold ${CYCLE_LABEL[cy].field.toLowerCase()}`}
                      onChange={(on) => set({ prices: { ...form.prices, [cy]: { ...p, on } } })}
                    />
                    {p.on ? (
                      <div className="space-y-1">
                        <Input
                          aria-label={`${CYCLE_LABEL[cy].field} price in pesos`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={p.text}
                          onChange={(e) =>
                            set({
                              prices: { ...form.prices, [cy]: { ...p, text: e.target.value } },
                            })
                          }
                          {...errorFor(cy)}
                        />
                        <FieldError id={id(`${cy}-error`)}>{errors[cy]}</FieldError>
                      </div>
                    ) : (
                      <p className="self-center text-sm text-muted-foreground">Not sold this way</p>
                    )}
                  </div>
                );
              })}
            </fieldset>
            {errors.prices ? (
              <p className="mt-3 text-xs font-semibold text-destructive">{errors.prices}</p>
            ) : null}
          </Surface>

          <Surface
            title="Features"
            description="What the plan unlocks. The list is fixed: a new feature needs a code change first. A kasambahay's rest, leave and record are on every plan."
          >
            <fieldset disabled={locked} className="-my-2.5 divide-y divide-border">
              <legend className="sr-only">Features</legend>
              {FEATURES.map((f) => (
                <Checkbox
                  key={f.key}
                  checked={f.everyPlan ? true : form.features[f.key]}
                  disabled={!!f.everyPlan}
                  label={f.name}
                  description={f.everyPlan ? `${f.description} ${f.everyPlan}` : f.description}
                  onChange={(on) => set({ features: { ...form.features, [f.key]: on } })}
                  extra={
                    f.everyPlan ? (
                      <StatusChip tone="done">Every plan</StatusChip>
                    ) : featureOffForEveryone(state, f.key) ? (
                      <RecordLink to="/switches" className="text-xs">
                        Off for everyone
                      </RecordLink>
                    ) : null
                  }
                />
              ))}
            </fieldset>
            {errors.features ? (
              <p className="mt-3 text-xs font-semibold text-destructive">{errors.features}</p>
            ) : null}
          </Surface>

          <Surface
            title="Limits"
            description="Kasambahay count once across all of a manager's households. Add-ons raise these."
          >
            <fieldset disabled={locked} className="divide-y divide-border">
              <legend className="sr-only">Limits</legend>
              {LIMIT_KEYS.map((k) => {
                const l = form.limits[k];
                return (
                  <div
                    key={k}
                    className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_8rem_minmax(0,1fr)] sm:items-center"
                  >
                    <label
                      htmlFor={id(`limit-${k}`)}
                      className="text-sm font-semibold text-foreground"
                    >
                      {LIMIT_LABEL[k].field}
                    </label>
                    <Input
                      id={id(`limit-${k}`)}
                      inputMode="numeric"
                      disabled={l.unlimited || locked}
                      value={l.unlimited ? "" : l.text}
                      placeholder={l.unlimited ? "No limit" : ""}
                      onChange={(e) =>
                        set({ limits: { ...form.limits, [k]: { ...l, text: e.target.value } } })
                      }
                      {...errorFor(k)}
                    />
                    <Checkbox
                      checked={l.unlimited}
                      label="Unlimited"
                      onChange={(unlimited) =>
                        set({
                          limits: {
                            ...form.limits,
                            [k]: { unlimited, text: unlimited ? l.text : l.text || "1" },
                          },
                        })
                      }
                    />
                    <div className="sm:col-span-3">
                      <FieldError id={id(`${k}-error`)}>{errors[k]}</FieldError>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          </Surface>
        </div>

        <div className="space-y-6 lg:sticky lg:top-22">
          <PublishingPanel plan={plan} dirty={dirty} households={households} />
          <VersionsPanel plan={plan} />
        </div>
      </div>

      {dirty && !locked ? (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-lift duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-4 motion-reduce:animate-none lg:left-64"
        >
          <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-foreground">Unsaved changes</p>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {saveError ??
                  (!valid
                    ? "Fix the fields marked in red to save."
                    : isVersioned(plan)
                      ? `Saves as version ${nextVersion}. The ${plural(onCurrent, "household")} on version ${currentVersion(plan)} ${keeps(onCurrent)} it.`
                      : "Saves the draft. Nobody can sign up to it until it's published.")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSaveError(null);
                  setForm(toForm(plan.content));
                }}
              >
                Discard
              </Button>
              <Button disabled={!valid} onClick={save}>
                {isVersioned(plan) ? `Save as version ${nextVersion}` : "Save draft"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One plan's editor, on sample data (D47). */
export function PlanPage({ planId }: { planId: string }) {
  const { plans } = useCatalog();
  const plan = plans.find((p) => p.id === planId);
  if (!plan) {
    return (
      <>
        <PageHeader back={<BackLink to="/plans">Plans</BackLink>} title="Plan not found" />
        <Surface>
          <EmptyState title="This plan isn't in the catalog">
            It may have been deleted, or the sample was reset.
          </EmptyState>
        </Surface>
      </>
    );
  }
  // A new key when the saved plan changes (a save, a status change, a reset)
  // starts the form from the saved values.
  return (
    <PlanEditor key={`${plan.id}:${plan.status}:${JSON.stringify(plan.content)}`} plan={plan} />
  );
}
