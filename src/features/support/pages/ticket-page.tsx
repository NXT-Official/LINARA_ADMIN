import type { ReactNode } from "react";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SegmentedFilter } from "@/components/shared/list-toolbar";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { RefreshButton } from "@/components/shared/refresh-button";
import { DetailSkeleton, EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, CHANNEL_LABEL, PRIORITY_LABEL, TICKET_STATUS_LABEL } from "@/data/labels";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { useCan } from "@/features/auth/use-can";
import { useAdmins } from "@/features/team/use-admins";
import { formatDateTime } from "@/lib/format";

import { LinksDialog } from "../components/links-dialog";
import { addNoteFn, assignFn, getTicketFn, setPriorityFn, setStatusFn } from "../support.actions";
import { ticketRef } from "../support.input";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
} from "../support.types";

const back = <BackLink to="/support">Support</BackLink>;

const selectClass =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

/** One ticket (FR-SP-3 to FR-SP-7). */
export function TicketPage({ ticketId }: { ticketId: string }) {
  const { data, isPending, dataUpdatedAt } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicketFn({ data: { ticketId } }),
  });
  if (isPending) return <DetailSkeleton label="Loading ticket" />;
  if (!data?.ok) {
    const missing = data?.code === "not_found";
    return (
      <>
        <PageHeader title={missing ? "Ticket not found" : "The ticket didn't load"} back={back} />
        <Surface>
          <EmptyState title={missing ? "There's no ticket with this address" : "Try again"}>
            {missing ? null : data?.message}
          </EmptyState>
        </Surface>
      </>
    );
  }
  return (
    <TicketView
      ticket={data.ticket}
      refreshButton={
        <RefreshButton queryKeys={[["ticket", ticketId], ["audit"]]} updatedAt={dataUpdatedAt} />
      }
    />
  );
}

function TicketView({ ticket, refreshButton }: { ticket: TicketDetail; refreshButton: ReactNode }) {
  const queryClient = useQueryClient();
  const admins = useAdmins();
  const canWrite = useCan()("support.write");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["ticket", ticket.ticketId] });
    await queryClient.invalidateQueries({ queryKey: ["support"] });
  };
  /** Runs one change and refreshes; a refusal shows its message. */
  async function change(run: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(true);
    try {
      const res = await run();
      if (res.ok) await refresh();
      else toast.error(res.message);
    } catch {
      toast.error("Something went wrong on our side. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await change(async () => {
      const res = await addNoteFn({ data: { ticketId: ticket.ticketId, body: note } });
      if (res.ok) setNote("");
      return res;
    });
  }

  return (
    <>
      <PageHeader
        back={back}
        title={ticket.subject}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip tone={TICKET_STATUS_TONE[ticket.status]}>
              {TICKET_STATUS_LABEL[ticket.status]}
            </StatusChip>
            <span>
              {ticketRef(ticket.ref)}, logged {formatDateTime(ticket.createdAt)}
            </span>
          </span>
        }
        actions={refreshButton}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Surface title="Request">
            {/* Plain text only (S-15). */}
            <p className="max-w-prose whitespace-pre-line break-words text-sm text-foreground">
              {ticket.body}
            </p>
          </Surface>

          <Surface title="Notes" description="Internal. The user never sees these." flush>
            {ticket.notes.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground sm:px-6">No notes yet.</p>
            ) : (
              <ol className="divide-y divide-border">
                {ticket.notes.map((n) => (
                  <li key={n.id} className="px-5 py-4 sm:px-6">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {admins.name(n.authorId)}
                      </span>{" "}
                      {formatDateTime(n.createdAt)}
                    </p>
                    <p className="mt-1 max-w-prose whitespace-pre-line break-words text-sm text-foreground">
                      {n.body}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {canWrite ? (
              <form
                onSubmit={addNote}
                className="space-y-2 border-t border-border px-5 py-4 sm:px-6"
              >
                <label
                  htmlFor="ticket-note"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Add a note
                </label>
                <Textarea
                  id="ticket-note"
                  rows={3}
                  maxLength={5000}
                  placeholder="What was said or done, including replies sent on the channel"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button type="submit" disabled={busy || !note.trim()}>
                  Add note
                </Button>
              </form>
            ) : null}
          </Surface>

          <AuditTrail targetId={ticket.ticketId} />
        </div>

        <div className="space-y-6">
          <Surface title="Handling">
            {!canWrite ? (
              <DetailList
                items={[
                  { label: "Status", value: TICKET_STATUS_LABEL[ticket.status] },
                  { label: "Priority", value: PRIORITY_LABEL[ticket.priority] },
                  {
                    label: "Assigned to",
                    value: ticket.assigneeId ? admins.name(ticket.assigneeId) : "No one",
                  },
                ]}
              />
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Status</p>
                  <SegmentedFilter
                    label="Status"
                    value={ticket.status}
                    onChange={(status: TicketStatus) =>
                      status !== ticket.status &&
                      change(() => setStatusFn({ data: { ticketId: ticket.ticketId, status } }))
                    }
                    options={TICKET_STATUSES.map((s) => ({
                      value: s,
                      label: TICKET_STATUS_LABEL[s],
                    }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Priority</p>
                  <SegmentedFilter
                    label="Priority"
                    value={ticket.priority}
                    onChange={(priority: TicketPriority) =>
                      priority !== ticket.priority &&
                      change(() => setPriorityFn({ data: { ticketId: ticket.ticketId, priority } }))
                    }
                    options={TICKET_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="ticket-assignee"
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    Assigned to
                  </label>
                  <select
                    id="ticket-assignee"
                    className={selectClass}
                    disabled={busy}
                    value={ticket.assigneeId ?? ""}
                    onChange={(e) =>
                      change(() =>
                        assignFn({
                          data: { ticketId: ticket.ticketId, assigneeId: e.target.value || null },
                        }),
                      )
                    }
                  >
                    <option value="">No one</option>
                    {admins.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {ticket.assigneeId &&
                    !admins.admins.some((a) => a.userId === ticket.assigneeId) ? (
                      <option value={ticket.assigneeId}>Former member</option>
                    ) : null}
                  </select>
                  {admins.me && ticket.assigneeId !== admins.me ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        change(() =>
                          assignFn({ data: { ticketId: ticket.ticketId, assigneeId: admins.me } }),
                        )
                      }
                    >
                      Assign to me
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </Surface>

          <Surface
            title="Details"
            actions={
              canWrite ? (
                <LinksDialog
                  ticket={ticket}
                  onSaved={() => void refresh()}
                  trigger={
                    <Button size="sm" variant="outline">
                      Change links
                    </Button>
                  }
                />
              ) : undefined
            }
          >
            <DetailList
              items={[
                { label: "Channel", value: CHANNEL_LABEL[ticket.channel] },
                { label: "Category", value: CATEGORY_LABEL[ticket.category] },
                {
                  label: "Name on the channel",
                  value: ticket.contact ?? "",
                  hidden: !ticket.contact,
                },
                {
                  label: "User",
                  value: ticket.userId ? (
                    <RecordLink to={`/users/${ticket.userId}`}>
                      {ticket.userName ?? "Linked user"}
                    </RecordLink>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "Household",
                  value: ticket.householdId ? (
                    <RecordLink to={`/households/${ticket.householdId}`}>
                      {ticket.householdName ?? "Linked household"}
                    </RecordLink>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "CRM contact",
                  value: ticket.contactId ? (
                    <RecordLink to={`/crm/${ticket.contactId}`}>
                      {ticket.contactName ?? "Linked contact"}
                    </RecordLink>
                  ) : (
                    "None"
                  ),
                },
                { label: "Logged by", value: admins.name(ticket.createdBy) ?? "" },
              ]}
            />
          </Surface>
        </div>
      </div>
    </>
  );
}
