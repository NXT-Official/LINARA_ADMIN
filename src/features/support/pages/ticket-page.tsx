import { useState, type FormEvent } from "react";

import { SelectField } from "@/components/shared/form";
import { sampleToast } from "@/lib/sample-toast";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { PRIORITY_TONE, TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { CURRENT_STAFF_ID } from "@/data/sample";
import { CATEGORY_LABEL, CHANNEL_LABEL, PRIORITY_LABEL, TICKET_STATUS_LABEL } from "@/data/labels";
import {
  contactById,
  householdById,
  listStaff,
  staffById,
  ticketById,
  userById,
} from "@/data/queries";
import type { TicketStatus } from "@/data/types";
import { formatDateTime } from "@/lib/format";

const STATUS_OPTIONS = (Object.entries(TICKET_STATUS_LABEL) as [TicketStatus, string][]).map(
  ([value, label]) => ({ value, label }),
);

export function TicketPage({ ticketId }: { ticketId: string }) {
  const ticket = ticketById(ticketId);
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? "open");
  const [assignee, setAssignee] = useState(ticket?.assigneeId ?? "");
  const [note, setNote] = useState("");

  if (!ticket) {
    return (
      <>
        <PageHeader title="Ticket not found" back={<BackLink to="/support">Support</BackLink>} />
        <Surface>
          <EmptyState title="There's no ticket with this address" />
        </Surface>
      </>
    );
  }

  const user = userById(ticket.userId);
  const household = householdById(ticket.householdId);
  const contact = ticket.contactId ? contactById(ticket.contactId) : null;

  function addNote(e: FormEvent) {
    e.preventDefault();
    setNote("");
    sampleToast("Note added");
  }

  return (
    <>
      <PageHeader
        back={<BackLink to="/support">Support</BackLink>}
        title={ticket.subject}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip tone={TICKET_STATUS_TONE[ticket.status]}>
              {TICKET_STATUS_LABEL[ticket.status]}
            </StatusChip>
            {ticket.priority !== "normal" ? (
              <StatusChip tone={PRIORITY_TONE[ticket.priority]}>
                {PRIORITY_LABEL[ticket.priority]} priority
              </StatusChip>
            ) : null}
            <span>
              LIN-{ticket.ref}, opened {formatDateTime(ticket.createdAt)}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Surface title="Request">
            <p className="max-w-prose whitespace-pre-line text-sm text-foreground">{ticket.body}</p>
          </Surface>

          <Surface title="Notes" description="Internal. The user never sees these." flush>
            {ticket.notes.length > 0 ? (
              <ol className="divide-y divide-border">
                {ticket.notes.map((n) => (
                  <li key={n.id} className="px-5 py-4 sm:px-6">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {n.authorId === CURRENT_STAFF_ID ? "You" : staffById(n.authorId)?.fullName}
                      </span>{" "}
                      {formatDateTime(n.createdAt)}
                    </p>
                    <p className="mt-1 max-w-prose whitespace-pre-line text-sm text-foreground">
                      {n.body}
                    </p>
                  </li>
                ))}
              </ol>
            ) : null}
            <form onSubmit={addNote} className="space-y-2 border-t border-border px-5 py-4 sm:px-6">
              <Label htmlFor="note" className="text-xs font-semibold text-muted-foreground">
                Add a note
              </Label>
              <Textarea
                id="note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What you did, or what you replied on the channel"
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={!note.trim()}>
                  Add note
                </Button>
              </div>
            </form>
          </Surface>

          <AuditTrail targetId={ticket.id} />
        </div>

        <div className="space-y-6">
          <Surface title="Handling">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="status" className="text-xs font-semibold text-muted-foreground">
                  Status
                </Label>
                <SelectField
                  id="status"
                  value={status}
                  onChange={(v) => {
                    setStatus(v);
                    sampleToast(`Status changed to ${TICKET_STATUS_LABEL[v].toLowerCase()}`);
                  }}
                  options={STATUS_OPTIONS}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assignee" className="text-xs font-semibold text-muted-foreground">
                  Assigned to
                </Label>
                <SelectField
                  id="assignee"
                  value={assignee}
                  placeholder="No one"
                  onChange={(v) => {
                    setAssignee(v);
                    sampleToast("Ticket assigned");
                  }}
                  options={listStaff().map((s) => ({
                    value: s.id,
                    label: s.id === CURRENT_STAFF_ID ? `${s.fullName} (you)` : s.fullName,
                  }))}
                />
              </div>
            </div>
          </Surface>

          <Surface title="Details">
            <DetailList
              items={[
                { label: "Channel", value: CHANNEL_LABEL[ticket.channel] },
                { label: "Category", value: CATEGORY_LABEL[ticket.category] },
                {
                  label: "Name on the channel",
                  value: ticket.contactHandle,
                  hidden: !ticket.contactHandle,
                },
                {
                  label: "User",
                  value: user ? (
                    <RecordLink to={`/users/${user.id}`}>{user.fullName}</RecordLink>
                  ) : (
                    "Not linked"
                  ),
                },
                {
                  label: "Household",
                  value: household ? (
                    <RecordLink to={`/households/${household.id}`}>{household.name}</RecordLink>
                  ) : (
                    "Not linked"
                  ),
                },
                {
                  label: "CRM contact",
                  value: contact ? (
                    <RecordLink to={`/crm/${contact.id}`}>{contact.fullName}</RecordLink>
                  ) : (
                    "Not linked"
                  ),
                },
              ]}
            />
          </Surface>
        </div>
      </div>
    </>
  );
}
