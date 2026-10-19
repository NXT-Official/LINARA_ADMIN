import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip, type ChipTone } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/use-can";

import { PlanDialog } from "../components/plan-dialog";
import { SettingsDialog } from "../components/settings-dialog";
import { getBillingSettingsFn, listPlansFn, setPlanStatusFn } from "../plans.actions";
import { describePlanPricing } from "../plans.pricing";
import type { BillingSettings, Plan, PlanStatus } from "../plans.types";
import { PLAN_KEYS } from "../plans-keys";

const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};
const STATUS_TONE: Record<PlanStatus, ChipTone> = {
  draft: "neutral",
  active: "done",
  archived: "quiet",
};

const seats = (n: number | null) => (n === null ? "Unlimited" : String(n));

/** The status moves a row offers, by its current status (the database refuses any other). */
const MOVES: Record<PlanStatus, { label: string; to: PlanStatus; done: string }[]> = {
  draft: [
    { label: "Publish", to: "active", done: "Plan published" },
    { label: "Archive", to: "archived", done: "Plan archived" },
  ],
  active: [
    { label: "Unpublish", to: "draft", done: "Plan unpublished" },
    { label: "Archive", to: "archived", done: "Plan archived" },
  ],
  archived: [{ label: "Restore", to: "draft", done: "Plan restored as a draft" }],
};

function PlanRow({
  plan,
  canManage,
  onEdit,
}: {
  plan: Plan;
  canManage: boolean;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function change(to: PlanStatus, done: string) {
    setBusy(true);
    try {
      const res = await setPlanStatusFn({ data: { planId: plan.id, status: to } });
      if (res.ok) toast.success(done);
      else toast.error(res.message);
      await queryClient.invalidateQueries({ queryKey: PLAN_KEYS.plans });
    } catch {
      toast.error("Something went wrong on our side. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
          <StatusChip tone={STATUS_TONE[plan.status]}>{STATUS_LABEL[plan.status]}</StatusChip>
          {plan.isPublic ? <StatusChip tone="neutral">Public</StatusChip> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{describePlanPricing(plan)}</p>
        {plan.tagline ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{plan.tagline}</p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" aria-label={`Edit ${plan.name}`} onClick={onEdit}>
            Edit
          </Button>
          {MOVES[plan.status].map((move) => (
            <Button
              key={move.label}
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label={`${move.label} ${plan.name}`}
              onClick={() => void change(move.to, move.done)}
            >
              {move.label}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function FreeTier({
  settings,
  canManage,
  onEdit,
}: {
  settings: BillingSettings;
  canManage: boolean;
  onEdit: () => void;
}) {
  return (
    <Surface
      title="Free tier"
      description="What a household gets before it has a plan."
      actions={
        canManage ? (
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit free tier
          </Button>
        ) : undefined
      }
    >
      <DetailList
        items={[
          {
            label: "Free use",
            value: settings.freeTierEnabled ? (
              <StatusChip tone="done">On</StatusChip>
            ) : (
              <StatusChip tone="quiet">Off</StatusChip>
            ),
          },
          { label: "Helper seats", value: seats(settings.freeHelperSeats) },
          { label: "Manager seats", value: seats(settings.freeManagerSeats) },
          { label: "Support email", value: settings.supportEmail ?? "Not set" },
        ]}
      />
    </Surface>
  );
}

/** Plans: price them, publish them, and set the free tier. Managing needs billing.manage. */
export function PlansPage() {
  const can = useCan();
  const canManage = can("billing.manage");
  const plans = useQuery({ queryKey: PLAN_KEYS.plans, queryFn: () => listPlansFn() });
  const settings = useQuery({
    queryKey: PLAN_KEYS.settings,
    queryFn: () => getBillingSettingsFn(),
  });
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [editingFree, setEditingFree] = useState(false);

  const planList = plans.data?.ok ? plans.data.plans : null;
  const failure = plans.isError
    ? "The plans didn't load."
    : plans.data && !plans.data.ok
      ? plans.data.message
      : null;
  const freeFailure = settings.isError
    ? "The free tier didn't load."
    : settings.data && !settings.data.ok
      ? settings.data.message
      : null;

  return (
    <>
      <PageHeader
        title="Plans"
        description="What households can buy, what each plan includes, and the free tier."
        actions={
          canManage ? (
            <Button onClick={() => setEditing("new")}>
              <Plus />
              New plan
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-6">
        <Surface flush>
          {failure ? (
            <div className="px-5 pb-6 pt-5 sm:px-6">
              <EmptyState title="The plans didn't load">
                {failure}{" "}
                <Button size="sm" variant="outline" onClick={() => void plans.refetch()}>
                  Try again
                </Button>
              </EmptyState>
            </div>
          ) : plans.isPending ? (
            <p role="status" className="px-5 py-6 text-sm text-muted-foreground sm:px-6">
              Loading plans
            </p>
          ) : planList && planList.length === 0 ? (
            <div className="px-5 pb-6 pt-5 sm:px-6">
              <EmptyState title="No plans yet">
                Until one is published, the pricing page tells people pricing is by conversation.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-border" aria-label="Plans">
              {(planList ?? []).map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  canManage={canManage}
                  onEdit={() => setEditing(plan)}
                />
              ))}
            </ul>
          )}
        </Surface>

        {freeFailure ? (
          <Surface title="Free tier">
            <EmptyState title="The free tier didn't load">{freeFailure}</EmptyState>
          </Surface>
        ) : settings.data?.ok ? (
          <FreeTier
            settings={settings.data.settings}
            canManage={canManage}
            onEdit={() => setEditingFree(true)}
          />
        ) : (
          <Surface title="Free tier">
            <p role="status" className="text-sm text-muted-foreground">
              Loading the free tier
            </p>
          </Surface>
        )}
      </div>

      {editing !== null ? (
        <PlanDialog
          key={editing === "new" ? "new" : editing.id}
          plan={editing === "new" ? null : editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}
      {editingFree && settings.data?.ok ? (
        <SettingsDialog
          settings={settings.data.settings}
          open
          onOpenChange={(o) => {
            if (!o) setEditingFree(false);
          }}
        />
      ) : null}
    </>
  );
}
