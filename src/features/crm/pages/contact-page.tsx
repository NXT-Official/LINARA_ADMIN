import type { ReactNode } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarPlus, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

import { SegmentedFilter } from "@/components/shared/list-toolbar";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { RefreshButton } from "@/components/shared/refresh-button";
import { DetailSkeleton, EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { STAGE_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_LABEL,
  CUSTOMER_STAGE_LABEL,
  LEAD_STAGE_LABEL,
  SOURCE_LABEL,
  USER_KIND_LABEL,
} from "@/data/labels";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { RecordTickets } from "@/features/support/components/record-tickets";
import { useCan } from "@/features/auth/use-can";
import { useAdmins } from "@/features/team/use-admins";
import { daysBetween, formatDate, formatDateTime, formatRelativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  ConfirmDialog,
  EditContactDialog,
  FollowUpDialog,
  LogActivityDialog,
  MarkLostDialog,
} from "../components/crm-dialogs";
import { LinkAccountDialog } from "../components/link-account-dialog";
import {
  completeFollowUpFn,
  deleteLeadFn,
  getContactFn,
  linkContactFn,
  linkSuggestionsFn,
  setLeadStageFn,
  unlinkContactFn,
} from "../crm.actions";
import { LEAD_STAGES, type ContactDetail, type ContactRef, type LeadStage } from "../crm.types";
import { contactRef as refOf, stageLabel } from "../crm.utils";

const back = <BackLink to="/crm">CRM</BackLink>;

/** One contact (FR-CRM-12): a saved one by id, or a manager not saved yet. */
export function ContactPage({ contactRef }: { contactRef: ContactRef }) {
  const { data, isPending, dataUpdatedAt } = useQuery({
    queryKey: ["contact", contactRef],
    queryFn: () => getContactFn({ data: contactRef }),
  });

  if (isPending) return <DetailSkeleton label="Loading contact" />;
  if (!data?.ok) {
    const missing = data?.code === "not_found";
    return (
      <>
        <PageHeader title={missing ? "Contact not found" : "The contact didn't load"} back={back} />
        <Surface>
          <EmptyState title={missing ? "There's no contact with this address" : "Try again"}>
            {missing
              ? "It may have been deleted. Go back to the CRM to find the person."
              : data?.message}
          </EmptyState>
        </Surface>
      </>
    );
  }
  return (
    <ContactView
      contact={data.contact}
      refreshButton={
        <RefreshButton
          queryKeys={[["contact", contactRef], ["crm", "suggestions"], ["audit"], ["support"]]}
          updatedAt={dataUpdatedAt}
        />
      }
    />
  );
}

function ContactView({
  contact,
  refreshButton,
}: {
  contact: ContactDetail;
  refreshButton: ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const admins = useAdmins();
  const canWrite = useCan()("crm.write");
  const ref = refOf(contact);
  const isLead = contact.kind === "lead";
  const [lostOpen, setLostOpen] = useState(false);
  const refresh = () =>
    queryClient
      .invalidateQueries({ queryKey: ["crm"] })
      .then(() => queryClient.invalidateQueries({ queryKey: ["contact"] }));

  const { data: suggestionData } = useQuery({
    queryKey: ["crm", "suggestions", contact.contactId],
    queryFn: () => linkSuggestionsFn({ data: { contactId: contact.contactId ?? "" } }),
    enabled: isLead && !!contact.contactId && !!contact.email,
  });
  const suggestion = suggestionData?.ok ? suggestionData.suggestions[0] : undefined;

  async function changeStage(stage: LeadStage) {
    if (!contact.contactId || stage === contact.leadStage) return;
    if (stage === "lost") {
      setLostOpen(true);
      return;
    }
    const res = await setLeadStageFn({ data: { contactId: contact.contactId, stage } });
    if (res.ok) {
      toast.success(`Moved to ${LEAD_STAGE_LABEL[stage].toLowerCase()}`);
      await refresh();
    } else {
      toast.error(res.message);
    }
  }

  return (
    <>
      <PageHeader
        back={back}
        title={contact.fullName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip tone={STAGE_TONE[contact.stage]}>{stageLabel(contact)}</StatusChip>
            <span>
              {isLead ? "Lead" : "Customer"},{" "}
              {contact.ownerId ? `owned by ${admins.name(contact.ownerId)}` : "no owner yet"}
            </span>
          </span>
        }
        actions={
          <>
            {refreshButton}
            {canWrite ? (
              <>
                <FollowUpDialog
                  name={contact.fullName}
                  contactRef={ref}
                  onSaved={refresh}
                  trigger={
                    <Button variant="outline">
                      <CalendarPlus />
                      Add follow-up
                    </Button>
                  }
                />
                <LogActivityDialog
                  name={contact.fullName}
                  contactRef={ref}
                  onSaved={refresh}
                  trigger={
                    <Button>
                      <MessageSquarePlus />
                      Log activity
                    </Button>
                  }
                />
              </>
            ) : undefined}
          </>
        }
      />

      {canWrite && suggestion && contact.contactId ? (
        <div
          role="status"
          className="mb-6 flex flex-col gap-3 rounded-3xl bg-terracotta-soft px-5 py-4 text-hearth-ink sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <p className="text-sm">
            This email matches a Linara manager account
            {suggestion.fullName ? (
              <>
                {" "}
                (<strong>{suggestion.fullName}</strong>)
              </>
            ) : null}
            . Link them to make this lead a customer.
          </p>
          <Button
            className="shrink-0"
            onClick={async () => {
              const res = await linkContactFn({
                data: { contactId: contact.contactId ?? "", userId: suggestion.userId },
              });
              if (res.ok) {
                toast.success("Contact linked");
                await refresh();
              } else {
                toast.error(res.message);
              }
            }}
          >
            Link to account
          </Button>
        </div>
      ) : null}

      {canWrite && isLead && contact.contactId ? (
        <div className="mb-6">
          <SegmentedFilter
            label="Lead stage"
            value={contact.leadStage ?? "new"}
            onChange={changeStage}
            options={LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABEL[s] }))}
          />
          {contact.leadStage === "lost" && contact.lostReason ? (
            <p className="mt-2 text-sm text-muted-foreground">Lost: {contact.lostReason}</p>
          ) : null}
          <MarkLostDialog
            open={lostOpen}
            onOpenChange={setLostOpen}
            contactId={contact.contactId}
            onSaved={refresh}
          />
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
                {contact.activities.map((a) => (
                  <li key={a.id} className="px-5 py-4 sm:px-6">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {ACTIVITY_LABEL[a.kind]}
                      </span>
                      <span>{formatDateTime(a.occurredAt)}</span>
                      <span>by {admins.name(a.authorId)}</span>
                    </p>
                    {/* Plain text only (S-15). */}
                    <p className="mt-1 max-w-prose whitespace-pre-line text-sm text-foreground">
                      {a.body}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Surface>

          <Surface title="Follow-ups" flush>
            {contact.followUps.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No follow-ups.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {contact.followUps.map((f) => {
                  const late = !f.doneAt && daysBetween(new Date(), f.dueAt) < 0;
                  return (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6"
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-sm text-foreground",
                            f.doneAt && "text-muted-foreground line-through",
                          )}
                        >
                          {f.note}
                        </p>
                        <p
                          className={cn(
                            "text-xs text-muted-foreground",
                            late && "font-semibold text-status-late-ink",
                          )}
                        >
                          {f.doneAt
                            ? `Done ${formatRelativeDay(f.doneAt)}`
                            : `Due ${formatRelativeDay(f.dueAt)}`}
                          , {admins.name(f.assigneeId)}
                        </p>
                      </div>
                      {f.doneAt || !canWrite ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Mark done: ${f.note}`}
                          onClick={async () => {
                            const res = await completeFollowUpFn({ data: { followUpId: f.id } });
                            if (res.ok) await refresh();
                            else toast.error(res.message);
                          }}
                        >
                          Mark done
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Surface>

          {/* With both ids the list matches either, so the person's tickets are the
              same here and on their user page (011). */}
          {contact.contactId ? (
            <RecordTickets
              filter={{
                contactId: contact.contactId,
                ...(contact.userId ? { userId: contact.userId } : {}),
              }}
            />
          ) : contact.userId ? (
            <RecordTickets filter={{ userId: contact.userId }} />
          ) : null}

          {contact.contactId ? <AuditTrail targetId={contact.contactId} /> : null}
        </div>

        <div className="space-y-6">
          <Surface
            title="Details"
            actions={
              canWrite ? (
                <EditContactDialog
                  contact={contact}
                  onSaved={async (savedId) => {
                    if (!contact.contactId) {
                      // A manager saved for the first time: their page now has an id (FR-CRM-3).
                      await navigate({ to: `/crm/${savedId}`, replace: true });
                      return;
                    }
                    await refresh();
                  }}
                  trigger={
                    <Button size="sm" variant="outline">
                      {isLead ? "Edit details" : "Edit owner and tags"}
                    </Button>
                  }
                />
              ) : undefined
            }
          >
            <DetailList
              items={[
                { label: "Email", value: contact.email ?? "Not set" },
                { label: "Phone", value: contact.phone ?? "Not set", hidden: !isLead },
                {
                  label: "Source",
                  value: contact.source ? SOURCE_LABEL[contact.source] : "Not set",
                  hidden: !isLead,
                },
                { label: "Owner", value: admins.name(contact.ownerId) ?? "No owner" },
                { label: "Tags", value: contact.tags.length ? contact.tags.join(", ") : "None" },
                {
                  label: "Consent",
                  value: contact.consentBasis ?? "",
                  hidden: !contact.consentBasis,
                },
                { label: "In the CRM since", value: formatDate(contact.createdAt) },
              ]}
            />
          </Surface>

          {contact.userId ? (
            <Surface
              title="Linara account"
              actions={<RecordLink to={`/users/${contact.userId}`}>Open user</RecordLink>}
              flush
            >
              {contact.households.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
                  Not managing a household.
                </p>
              ) : (
                <ul className="divide-y divide-border pb-2">
                  {contact.households.map((h) => (
                    <li key={h.householdId} className="px-5 py-3 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <RecordLink to={`/households/${h.householdId}`}>{h.name}</RecordLink>
                        <StatusChip tone={STAGE_TONE[h.stage]}>
                          {CUSTOMER_STAGE_LABEL[h.stage]}
                        </StatusChip>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {USER_KIND_LABEL[h.role]},{" "}
                        {h.lastActivityAt
                          ? `last task ${formatRelativeDay(h.lastActivityAt)}`
                          : "no tasks yet"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Surface>
          ) : null}

          {canWrite ? (
            <div className="flex flex-wrap gap-2 px-1">
              {isLead && contact.contactId ? (
                <LinkAccountDialog
                  contactId={contact.contactId}
                  onLinked={refresh}
                  trigger={<Button variant="outline">Link to an account</Button>}
                />
              ) : null}
              {isLead && contact.contactId ? (
                <ConfirmDialog
                  trigger={<Button variant="outline">Delete lead</Button>}
                  title="Delete this lead?"
                  description="Their activity and follow-ups are deleted too. The audit log keeps a record that it happened."
                  confirmLabel="Delete lead"
                  done="Lead deleted"
                  onConfirm={async () => {
                    const res = await deleteLeadFn({
                      data: { contactId: contact.contactId ?? "" },
                    });
                    if (res.ok) {
                      await queryClient.invalidateQueries({ queryKey: ["crm"] });
                      await navigate({ to: "/crm" });
                    }
                    return res;
                  }}
                />
              ) : null}
              {!isLead && contact.contactId ? (
                <ConfirmDialog
                  trigger={<Button variant="outline">Unlink account</Button>}
                  title="Unlink this account?"
                  description="The contact becomes a lead again, keeping its history. The person's Linara account isn't changed."
                  confirmLabel="Unlink account"
                  done="Account unlinked"
                  onConfirm={async () => {
                    const res = await unlinkContactFn({
                      data: { contactId: contact.contactId ?? "" },
                    });
                    if (res.ok) await refresh();
                    return res;
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
