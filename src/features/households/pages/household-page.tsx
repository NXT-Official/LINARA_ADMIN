import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { HiddenValue } from "@/components/shared/hidden-value";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { HELPER_STATUS_TONE } from "@/components/shared/tones";
import { HELPER_STATUS_LABEL, USER_KIND_LABEL } from "@/data/labels";
import { HouseholdBillingSection } from "@/features/billing/components/household-billing";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { RecordTickets } from "@/features/support/components/record-tickets";
import { payRevealer } from "@/features/pay/pay-reveal";
import { formatDate, formatRelativeDay } from "@/lib/format";

import { getHouseholdFn } from "../households.actions";
import type { HouseholdDetail, HouseholdHelper } from "../households.types";

/** One household, read-only (FR-HH-2, FR-HH-3). */
export function HouseholdPage({ householdId }: { householdId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => getHouseholdFn({ data: { householdId } }),
  });

  const back = <BackLink to="/households">Households</BackLink>;
  if (isPending) return <PageHeader title="Loading household" back={back} />;
  if (!data?.ok) {
    const missing = data?.code === "not_found";
    return (
      <>
        <PageHeader
          title={missing ? "Household not found" : "The household didn't load"}
          back={back}
        />
        <Surface>
          <EmptyState title={missing ? "There's no household with this address" : "Try again"}>
            {missing ? null : data?.message}
          </EmptyState>
        </Surface>
      </>
    );
  }
  return <HouseholdDetailView household={data.household} />;
}

function HouseholdDetailView({ household }: { household: HouseholdDetail }) {
  return (
    <>
      <PageHeader
        back={<BackLink to="/households">Households</BackLink>}
        title={household.name}
        description={`Created ${formatDate(household.createdAt)}`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Surface title="Helpers" flush>
            {household.helpers.length === 0 ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="No helpers yet">
                  The manager hasn't invited anyone from the household app.
                </EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {household.helpers.map((h) => (
                  <HelperItem key={h.helperId} helper={h} />
                ))}
              </ul>
            )}
          </Surface>

          <HouseholdBillingSection householdId={household.householdId} />

          <RecordTickets filter={{ householdId: household.householdId }} />

          <AuditTrail targetId={household.householdId} />
        </div>

        <div className="space-y-6">
          <Surface title="Managers" flush>
            {household.managers.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No managers.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {household.managers.map((m) => (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6"
                  >
                    <RecordLink to={`/users/${m.userId}`}>{m.fullName}</RecordLink>
                    <span className="inline-flex items-center gap-3 text-xs text-muted-foreground">
                      {USER_KIND_LABEL[m.role]}
                      <RecordLink to={`/crm/account/${m.userId}`} className="text-xs">
                        CRM<span className="sr-only">: {m.fullName}</span>
                      </RecordLink>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          <Surface title="Activity">
            <DetailList
              items={[
                { label: "Tasks scheduled, last 7 days", value: household.tasksScheduled7d },
                { label: "Tasks done, last 7 days", value: household.tasksDone7d },
                { label: "Tasks done, last 30 days", value: household.tasksDone30d },
                {
                  label: "Last activity",
                  value: household.lastActivityAt
                    ? formatRelativeDay(household.lastActivityAt)
                    : "No tasks yet",
                },
              ]}
            />
          </Surface>
        </div>
      </div>
    </>
  );
}

function HelperItem({ helper: h }: { helper: HouseholdHelper }) {
  const pay = useMemo(() => payRevealer(h.helperId), [h.helperId]);
  const facts = [
    h.station,
    h.employment,
    h.startedOn ? `since ${formatDate(h.startedOn)}` : null,
    h.endedOn ? `ended ${formatDate(h.endedOn)}` : null,
  ].filter(Boolean);

  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {h.userId ? (
            <RecordLink to={`/users/${h.userId}`}>{h.name}</RecordLink>
          ) : (
            <span className="text-sm font-semibold text-foreground">{h.name}</span>
          )}
          <StatusChip tone={HELPER_STATUS_TONE[h.status]}>
            {HELPER_STATUS_LABEL[h.status]}
          </StatusChip>
          {h.shared ? <StatusChip tone="neutral">Shared</StatusChip> : null}
        </div>
        {facts.length ? (
          <p className="mt-1 text-xs text-muted-foreground">{facts.join(", ")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm sm:justify-end">
        <span className="text-xs text-muted-foreground">Monthly wage</span>
        <HiddenValue what={`${h.name}'s monthly wage`} reveal={pay.wage} />
      </div>
    </li>
  );
}
