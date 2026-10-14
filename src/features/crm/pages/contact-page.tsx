import { CalendarPlus, MessageSquarePlus } from "lucide-react";

import { sampleToast } from "@/lib/sample-toast";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { STAGE_TONE, TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { CURRENT_STAFF_ID } from "@/data/sample";
import {
  ACTIVITY_LABEL,
  CUSTOMER_STAGE_LABEL,
  SOURCE_LABEL,
  TICKET_STATUS_LABEL,
  USER_KIND_LABEL,
} from "@/data/labels";
import {
  contactById,
  householdsOf,
  staffById,
  suggestedLink,
  ticketsFor,
  userById,
} from "@/data/queries";
import { formatDate, formatDateTime, formatRelativeDay, daysBetween } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FollowUpDialog, LogActivityDialog } from "../components/crm-dialogs";
import { householdStage } from "../crm-stage";
import { stageLabel } from "../crm.utils";

const who = (id: string | null) =>
  id === CURRENT_STAFF_ID ? "You" : (staffById(id)?.fullName ?? "No one");

export function ContactPage({ contactId }: { contactId: string }) {
  const contact = contactById(contactId);
  if (!contact) {
    return (
      <>
        <PageHeader title="Contact not found" back={<BackLink to="/crm">CRM</BackLink>} />
        <Surface>
          <EmptyState title="There's no contact with this address">
            It may have been deleted. Go back to the CRM to find the person.
          </EmptyState>
        </Surface>
      </>
    );
  }

  const now = new Date();
  const user = userById(contact.userId);
  const match = suggestedLink(contact);
  const tickets = ticketsFor({ contactId: contact.id, userId: contact.userId ?? undefined });
  const followUps = [...contact.followUps].sort(
    (a, b) => Number(!!a.doneAt) - Number(!!b.doneAt) || a.dueAt.localeCompare(b.dueAt),
  );

  return (
    <>
      <PageHeader
        back={<BackLink to="/crm">CRM</BackLink>}
        title={contact.fullName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip tone={STAGE_TONE[contact.stage]}>{stageLabel(contact)}</StatusChip>
            <span>
              {contact.kind === "lead" ? "Lead" : "Customer"},{" "}
              {contact.ownerId
                ? `owned by ${contact.ownerId === CURRENT_STAFF_ID ? "you" : who(contact.ownerId)}`
                : "no owner yet"}
            </span>
          </span>
        }
        actions={
          <>
            <FollowUpDialog
              name={contact.fullName}
              trigger={
                <Button variant="outline">
                  <CalendarPlus />
                  Add follow-up
                </Button>
              }
            />
            <LogActivityDialog
              name={contact.fullName}
              trigger={
                <Button>
                  <MessageSquarePlus />
                  Log activity
                </Button>
              }
            />
          </>
        }
      />

      {match ? (
        <div
          role="status"
          className="mb-6 flex flex-col gap-3 rounded-3xl bg-terracotta-soft px-5 py-4 text-hearth-ink sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <p className="text-sm">
            This email matches <strong>{match.fullName}</strong>'s Linara account (
            {USER_KIND_LABEL[match.kind].toLowerCase()}). Link them to make this lead a customer.
          </p>
          <Button className="shrink-0" onClick={() => sampleToast("Contact linked")}>
            Link to account
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Surface title="Activity" description="Calls, messages and notes, newest first." flush>
            {contact.activities.length === 0 ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="Nothing logged yet">
                  Log the first call or message so the team knows where things stand.
                </EmptyState>
              </div>
            ) : (
              <ol className="divide-y divide-border pb-2">
                {[...contact.activities]
                  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                  .map((a) => (
                    <li key={a.id} className="px-5 py-4 sm:px-6">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {ACTIVITY_LABEL[a.kind]}
                        </span>
                        <span>{formatDateTime(a.occurredAt)}</span>
                        <span>by {who(a.authorId)}</span>
                      </p>
                      <p className="mt-1 max-w-prose whitespace-pre-line text-sm text-foreground">
                        {a.body}
                      </p>
                    </li>
                  ))}
              </ol>
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
        </div>

        <div className="space-y-6">
          <Surface title="Follow-ups" flush>
            {followUps.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">None planned.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {followUps.map((f) => {
                  const late = !f.doneAt && daysBetween(now, f.dueAt) < 0;
                  return (
                    <li
                      key={f.id}
                      className="flex items-start justify-between gap-3 px-5 py-3 sm:px-6"
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-sm",
                            f.doneAt ? "text-muted-foreground line-through" : "text-foreground",
                          )}
                        >
                          {f.note}
                        </p>
                        <p
                          className={cn(
                            "text-xs",
                            late ? "font-semibold text-status-late-ink" : "text-muted-foreground",
                          )}
                        >
                          {f.doneAt
                            ? `Done ${formatRelativeDay(f.doneAt, now)}`
                            : `Due ${formatRelativeDay(f.dueAt, now)}`}
                          , {who(f.assigneeId)}
                        </p>
                      </div>
                      {!f.doneAt ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sampleToast("Follow-up marked done")}
                        >
                          Mark done
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Surface>

          <Surface title="Details">
            <DetailList
              items={[
                { label: "Email", value: contact.email ?? "None" },
                { label: "Phone", value: contact.phone ?? "None" },
                {
                  label: "Source",
                  value: contact.source ? SOURCE_LABEL[contact.source] : "Signed up on their own",
                },
                {
                  label: "How they agreed to be contacted",
                  value: contact.consentBasis,
                  hidden: !contact.consentBasis,
                },
                { label: "Lost because", value: contact.lostReason, hidden: !contact.lostReason },
                { label: "Tags", value: contact.tags.length ? contact.tags.join(", ") : "None" },
                { label: "Added", value: formatDate(contact.createdAt) },
              ]}
            />
          </Surface>

          {user ? (
            <Surface title="Linara account">
              <DetailList
                items={[
                  {
                    label: "Account",
                    value: <RecordLink to={`/users/${user.id}`}>{user.fullName}</RecordLink>,
                  },
                  { label: "Role", value: USER_KIND_LABEL[user.kind] },
                  {
                    label: "Households",
                    value: (
                      <ul className="space-y-1">
                        {householdsOf(user).map((h) => (
                          <li key={h.id} className="flex flex-wrap items-center gap-2">
                            <RecordLink to={`/households/${h.id}`}>{h.name}</RecordLink>
                            <StatusChip tone={STAGE_TONE[householdStage(h, now)]}>
                              {CUSTOMER_STAGE_LABEL[householdStage(h, now)]}
                            </StatusChip>
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]}
              />
            </Surface>
          ) : null}
        </div>
      </div>
    </>
  );
}
