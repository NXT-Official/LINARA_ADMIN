import { HiddenValue } from "@/components/shared/hidden-value";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { HELPER_STATUS_TONE, STAGE_TONE, TICKET_STATUS_TONE } from "@/components/shared/tones";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { householdStage } from "@/features/crm/crm-stage";
import {
  CUSTOMER_STAGE_LABEL,
  HELPER_STATUS_LABEL,
  TICKET_STATUS_LABEL,
  USER_KIND_LABEL,
} from "@/data/labels";
import { contactForUser, householdById, ticketsFor, userById } from "@/data/queries";
import { formatDate, formatPeso, formatRelativeDay } from "@/lib/format";

export function HouseholdPage({ householdId }: { householdId: string }) {
  const household = householdById(householdId);
  if (!household) {
    return (
      <>
        <PageHeader
          title="Household not found"
          back={<BackLink to="/households">Households</BackLink>}
        />
        <Surface>
          <EmptyState title="There's no household with this address" />
        </Surface>
      </>
    );
  }

  const now = new Date();
  const stage = householdStage(household, now);
  const tickets = ticketsFor({ householdId: household.id });

  return (
    <>
      <PageHeader
        back={<BackLink to="/households">Households</BackLink>}
        title={household.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip tone={STAGE_TONE[stage]}>{CUSTOMER_STAGE_LABEL[stage]}</StatusChip>
            <span>Created {formatDate(household.createdAt)}</span>
          </span>
        }
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
                  <li key={h.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:px-6">
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
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {h.station}, {h.employment}, since {formatDate(h.startedOn)}
                        {h.endedOn ? `, ended ${formatDate(h.endedOn)}` : ""}
                      </p>
                    </div>
                    <div className="text-sm sm:text-right">
                      <span className="mr-2 text-xs text-muted-foreground">Monthly wage</span>
                      <HiddenValue value={formatPeso(h.monthlyRate)} what={`${h.name}'s wage`} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <Surface title="Support tickets" flush>
            {tickets.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No tickets.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {tickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
                  >
                    <RecordLink to={`/support/${t.id}`} className="min-w-0 truncate">
                      LIN-{t.ref} {t.subject}
                    </RecordLink>
                    <StatusChip tone={TICKET_STATUS_TONE[t.status]}>
                      {TICKET_STATUS_LABEL[t.status]}
                    </StatusChip>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <AuditTrail targetId={household.id} />
        </div>

        <div className="space-y-6">
          <Surface title="Managers" flush>
            <ul className="divide-y divide-border pb-2">
              {household.managers.map((m) => {
                const u = userById(m.userId);
                const contact = contactForUser(m.userId);
                return (
                  <li key={m.userId} className="px-5 py-3 sm:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <RecordLink to={`/users/${m.userId}`}>{u?.fullName ?? "Unknown"}</RecordLink>
                      <span className="text-xs text-muted-foreground">
                        {USER_KIND_LABEL[m.role]}
                      </span>
                    </div>
                    {contact ? (
                      <RecordLink to={`/crm/${contact.id}`} className="text-xs">
                        CRM contact
                      </RecordLink>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Surface>
          <Surface title="Last 7 days">
            <DetailList
              items={[
                { label: "Tasks created", value: household.tasksCreated7d },
                { label: "Tasks done", value: household.tasksDone7d },
                {
                  label: "Last task",
                  value: household.lastActivityAt
                    ? formatRelativeDay(household.lastActivityAt, now)
                    : "None yet",
                },
              ]}
            />
          </Surface>
        </div>
      </div>
    </>
  );
}
