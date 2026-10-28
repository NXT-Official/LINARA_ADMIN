import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { RecordLink, RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { TableSkeleton } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";

import { SAMPLE_NOTE, SampleActions } from "../components/sample-bar";
import {
  centavosToInput,
  currentVersion,
  formatCentavos,
  householdsOn,
  limitText,
  limitsSummary,
  parsePeso,
  PLAN_TONE,
  priceSummary,
  STATUS_LABEL,
} from "../plans.logic";
import { LIMIT_LABEL } from "../plans.sample";
import { dispatchCatalog, useBillingMode, useCatalog } from "../plans.store";
import type { Addon, Plan } from "../plans.types";

/** A short id from a name, unique in the catalog: "Family plus" -> "family-plus". */
function idFor(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "plan";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function NewPlanDialog() {
  const { plans } = useCatalog();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  return (
    <FormDialog
      trigger={<Button>New plan</Button>}
      title="New plan"
      description={`It starts as a draft with no features and no price, so nobody can sign up to it yet. ${SAMPLE_NOTE}`}
      submitLabel="Create draft"
      done={`Draft created. ${SAMPLE_NOTE}`}
      canSubmit={name.trim().length > 0}
      onSubmit={async () => {
        const id = idFor(name, new Set(plans.map((p) => p.id)));
        const res = dispatchCatalog({ type: "create_plan", id, name });
        if (!res.ok) return res;
        setName("");
        void navigate({ to: "/plans/$planId", params: { planId: id } });
        return { ok: true };
      }}
    >
      {(id) => (
        <Field label="Name" htmlFor={id("name")} hint="What households see, like Family or Pro.">
          <Input
            id={id("name")}
            value={name}
            maxLength={60}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      )}
    </FormDialog>
  );
}

function OrderButtons({ plan, first, last }: { plan: Plan; first: boolean; last: boolean }) {
  const name = plan.content.name;
  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${name} up`}
        disabled={first}
        onClick={() => dispatchCatalog({ type: "move_plan", planId: plan.id, direction: -1 })}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${name} down`}
        disabled={last}
        onClick={() => dispatchCatalog({ type: "move_plan", planId: plan.id, direction: 1 })}
      >
        <ArrowDown />
      </Button>
    </div>
  );
}

function AddonDialog({ addon }: { addon: Addon }) {
  const [name, setName] = useState(addon.name);
  const [price, setPrice] = useState(centavosToInput(addon.monthlyPrice));
  const [status, setStatus] = useState<Addon["status"]>(addon.status);
  const parsed = price.trim() === "" ? null : parsePeso(price);
  const priceError = parsed && !parsed.ok ? parsed.message : null;
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          Edit
        </Button>
      }
      title={`Edit ${addon.name}`}
      description={`Adds ${limitText(addon.limitKey, addon.step)} to a household's plan, each month. ${SAMPLE_NOTE}`}
      submitLabel="Save add-on"
      done={`Add-on saved. ${SAMPLE_NOTE}`}
      canSubmit={!priceError}
      onSubmit={async () =>
        dispatchCatalog({
          type: "save_addon",
          addon: {
            ...addon,
            name,
            status,
            monthlyPrice: parsed && parsed.ok ? parsed.centavos : null,
          },
        })
      }
    >
      {(id) => (
        <>
          <Field label="Name" htmlFor={id("name")}>
            <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Price a month, in pesos"
            htmlFor={id("price")}
            hint={priceError ?? "Leave empty until marketing sets it."}
          >
            <Input
              id={id("price")}
              inputMode="decimal"
              value={price}
              aria-invalid={!!priceError}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Offered" htmlFor={id("status")}>
            <SelectField
              id={id("status")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "active", label: "Offered to households" },
                { value: "hidden", label: "Not offered" },
              ]}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** The plan catalog and its add-ons, on sample data (D47). */
const PLANS_LIVE = "What households can subscribe to: prices, features and limits.";

/** Plans: its shape until the first read answers, never the sample in the meantime. */
export function PlansPage() {
  const { ready } = useBillingMode();
  if (!ready) {
    return (
      <>
        <PageHeader title="Plans" description={PLANS_LIVE} actions={<SampleActions />} />
        <Surface flush>
          <div className="pt-5">
            <TableSkeleton label="Loading plans" rows={3} />
          </div>
        </Surface>
      </>
    );
  }
  return <PlansScreen />;
}

function PlansScreen() {
  const { live } = useBillingMode();
  const state = useCatalog();
  const plans = [...state.plans].sort((a, b) => a.displayOrder - b.displayOrder);

  const planColumns: Column<Plan>[] = [
    {
      key: "plan",
      header: "Plan",
      mobile: "primary",
      cell: (p) => (
        <div className="min-w-0">
          <RowLink to={`/plans/${p.id}`}>{p.content.name}</RowLink>
          {p.content.description ? (
            <div className="text-xs text-muted-foreground">{p.content.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "primary",
      cell: (p) => <StatusChip tone={PLAN_TONE[p.status]}>{STATUS_LABEL[p.status]}</StatusChip>,
    },
    {
      key: "price",
      header: "Price",
      cell: (p) => (
        <div>
          <span className="whitespace-nowrap">{priceSummary(p.content)}</span>
          {p.pricePlaceholder ? (
            <div className="text-xs text-muted-foreground">Placeholder price</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "limits",
      header: "Allows",
      mobile: "hidden",
      className: "max-w-72",
      cell: (p) => limitsSummary(p.content),
    },
    {
      key: "version",
      header: "Version",
      mobile: "hidden",
      cell: (p) => (currentVersion(p) ? `Version ${currentVersion(p)}` : "Never published"),
    },
    {
      key: "households",
      header: "On the plan",
      align: "right",
      cell: (p) => (
        <span className="whitespace-nowrap tabular-nums">
          {plural(householdsOn(state, p.id), "household")}
        </span>
      ),
    },
    {
      key: "order",
      header: "Order",
      mobile: "hidden",
      cell: (p) => (
        <OrderButtons
          plan={p}
          first={p.id === plans[0]?.id}
          last={p.id === plans[plans.length - 1]?.id}
        />
      ),
    },
  ];

  const addonColumns: Column<Addon>[] = [
    {
      key: "name",
      header: "Add-on",
      mobile: "primary",
      cell: (a) => <span className="font-semibold text-foreground">{a.name}</span>,
    },
    {
      key: "adds",
      header: "Adds",
      cell: (a) =>
        `${a.step} ${a.step === 1 ? LIMIT_LABEL[a.limitKey].one : LIMIT_LABEL[a.limitKey].many}`,
    },
    {
      key: "price",
      header: "Price",
      mobile: "primary",
      cell: (a) =>
        a.monthlyPrice === null ? (
          <span className="text-muted-foreground">Not priced</span>
        ) : (
          <span className="tabular-nums">{formatCentavos(a.monthlyPrice)} a month</span>
        ),
    },
    {
      key: "status",
      header: "Offered",
      cell: (a) =>
        a.status === "active" ? (
          <StatusChip tone="done">Offered</StatusChip>
        ) : (
          <StatusChip tone="quiet">Not offered</StatusChip>
        ),
    },
    {
      key: "edit",
      header: "",
      // Keyed on the saved values, so the form opens on them after a save or a reset.
      cell: (a) => <AddonDialog key={JSON.stringify(a)} addon={a} />,
    },
  ];

  const offForEveryone = state.switches.filter((s) => !s.enabled);

  return (
    <>
      <PageHeader
        title="Plans"
        description={
          live
            ? PLANS_LIVE
            : "What households can subscribe to: prices, features and limits. A preview on sample data: changes stay in this tab and nothing is saved or charged."
        }
        actions={
          <>
            <SampleActions />
            <NewPlanDialog />
          </>
        }
      />
      <div className="space-y-6">
        {offForEveryone.length ? (
          <p className="text-sm text-muted-foreground">
            Off for everyone, whatever the plan:{" "}
            {offForEveryone.map((s, i) => (
              <span key={s.key}>
                {i > 0 ? ", " : null}
                <RecordLink to="/switches">{s.name}</RecordLink>
              </span>
            ))}
            .
          </p>
        ) : null}
        <Surface
          flush
          title="Plans"
          description="In the order households see them. Changing a published plan saves a new version; households already on it keep theirs."
        >
          <DataTable
            label="Plans"
            rows={plans}
            columns={planColumns}
            rowKey={(p) => p.id}
            empty={null}
          />
        </Surface>
        <Surface
          flush
          title="Add-ons"
          description="Extras a manager adds on top of any plan, billed monthly with it."
        >
          <DataTable
            label="Add-ons"
            rows={state.addons}
            columns={addonColumns}
            rowKey={(a) => a.id}
            empty={null}
          />
        </Surface>
      </div>
    </>
  );
}
