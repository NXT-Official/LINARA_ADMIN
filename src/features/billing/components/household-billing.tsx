import { useQuery, useQueryClient } from "@tanstack/react-query";

import { DetailList, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip, type ChipTone } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/use-can";
import { formatDate } from "@/lib/format";
import { fmtCentavos } from "@/lib/money";

import { getHouseholdBillingFn } from "../billing.actions";
import type { BillingEntitlements, HouseholdBilling } from "../billing.types";
import { GrantPlanDialog } from "./grant-plan-dialog";
import { MarkPaidDialog } from "./mark-paid-dialog";

const INTERVAL_LABEL = { one_time: "one time", monthly: "monthly", yearly: "yearly" } as const;

function statusChip(e: BillingEntitlements): { tone: ChipTone; label: string } {
  if (e.source === "free") return { tone: "neutral", label: "Free" };
  if (e.source === "none") return { tone: "neutral", label: "No plan" };
  switch (e.effectiveStatus) {
    case "active":
      return { tone: "done", label: "Active" };
    case "trialing":
      return { tone: "neutral", label: "Trial" };
    case "past_due":
      return { tone: "late", label: "Past due" };
    case "canceled":
      return { tone: "quiet", label: "Canceled" };
    default:
      return { tone: "quiet", label: "Expired" };
  }
}

const seatsOf = (used: number, limit: number | null) =>
  `${used} of ${limit === null ? "unlimited" : limit}`;

function planLine(b: HouseholdBilling): string {
  const e = b.entitlements;
  if (e.source === "free") return "Free tier";
  if (e.source === "none") return "No plan";
  const sub = b.subscriptions.find((s) => s.id === e.subscriptionId);
  const name = e.planName ?? "Plan";
  return sub ? `${name}, ${INTERVAL_LABEL[sub.interval]}` : name;
}

function periodLine(e: BillingEntitlements): string {
  if (e.source !== "subscription") return "Not applicable";
  return e.periodEnd ? `Until ${formatDate(e.periodEnd)}` : "No end date";
}

/**
 * A household's plan and billing, on its page: what it is entitled to, what it
 * uses, what is waiting to be paid, and the notes the billing system left.
 */
export function HouseholdBillingSection({ householdId }: { householdId: string }) {
  const can = useCan();
  const canView = can("billing.view");
  const canManage = can("billing.manage");
  const queryClient = useQueryClient();
  const key = ["household-billing", householdId];
  const { data, isPending } = useQuery({
    queryKey: key,
    queryFn: () => getHouseholdBillingFn({ data: { householdId } }),
    enabled: canView,
  });
  // A role without Billing doesn't see the panel at all.
  if (!canView) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["audit"] });
  };

  const grant = canManage ? (
    <GrantPlanDialog
      householdId={householdId}
      onDone={refresh}
      trigger={
        <Button size="sm" variant="outline">
          Grant plan
        </Button>
      }
    />
  ) : undefined;

  if (isPending) {
    return (
      <Surface title="Plan & billing">
        <p className="text-sm text-muted-foreground">Loading billing.</p>
      </Surface>
    );
  }
  if (!data?.ok) {
    return (
      <Surface title="Plan & billing">
        <EmptyState title="Billing figures didn't load">
          {data?.message ?? "Try again in a moment."}
        </EmptyState>
      </Surface>
    );
  }

  const b = data.billing;
  const chip = statusChip(b.entitlements);
  const pending = b.invoices.filter((i) => i.status === "pending");
  const refund = b.notes.some((n) => /refund/i.test(n.note));

  return (
    <Surface title="Plan & billing" actions={grant}>
      <DetailList
        items={[
          {
            label: "Plan",
            value: (
              <span className="inline-flex flex-wrap items-center gap-2">
                {planLine(b)}
                <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
              </span>
            ),
          },
          { label: "Period", value: periodLine(b.entitlements) },
          { label: "Helpers", value: seatsOf(b.usage.helpers, b.entitlements.helperSeats) },
          { label: "Managers", value: seatsOf(b.usage.managers, b.entitlements.managerSeats) },
          ...pending.map((i) => ({
            label: "Waiting to be paid",
            value: (
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {i.invoiceNumber}, {fmtCentavos(i.amountCentavos)}, created{" "}
                  {formatDate(i.createdAt)}
                </span>
                {canManage ? (
                  <MarkPaidDialog
                    invoice={i}
                    onDone={refresh}
                    trigger={
                      <Button size="sm" variant="outline">
                        Mark paid
                        <span className="sr-only"> {i.invoiceNumber}</span>
                      </Button>
                    }
                  />
                ) : null}
              </span>
            ),
          })),
        ]}
      />
      {b.notes.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">Notes</h3>
            {refund ? <StatusChip tone="attention">Needs attention</StatusChip> : null}
          </div>
          <ul className="mt-2 space-y-2">
            {b.notes.map((n) => (
              <li
                key={`${n.subscriptionId}-${n.note}`}
                className="text-[13px] text-muted-foreground"
              >
                {n.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Surface>
  );
}
