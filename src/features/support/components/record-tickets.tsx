import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { RecordLink } from "@/components/shared/links";
import { Surface } from "@/components/shared/page";
import { StatusChip } from "@/components/shared/status-chip";
import { TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { TICKET_STATUS_LABEL } from "@/data/labels";

import { listTicketsFn } from "../support.actions";
import { ticketRef } from "../support.input";
import { LogTicketDialog, type TicketLinks } from "./log-ticket-dialog";

/**
 * A record's support tickets on its page (FR-US-3, FR-HH-2, FR-CRM-12), with
 * "Log ticket" already linked to the record.
 */
export function RecordTickets({ filter }: { filter: TicketLinks }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const input = { page: 0, ...filter };
  const { data, isPending } = useQuery({
    queryKey: ["support", "tickets", input],
    queryFn: () => listTicketsFn({ data: input }),
  });
  const tickets = data?.ok ? data.tickets : [];

  return (
    <Surface
      title="Support tickets"
      flush
      actions={
        <LogTicketDialog
          links={filter}
          trigger={
            <Button size="sm" variant="outline">
              Log ticket
            </Button>
          }
          onLogged={(ticketId) => {
            void queryClient.invalidateQueries({ queryKey: ["support"] });
            void navigate({ to: `/support/${ticketId}` });
          }}
        />
      }
    >
      {isPending ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading tickets.</p>
      ) : data && !data.ok ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">{data.message}</p>
      ) : tickets.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No tickets.</p>
      ) : (
        <ul className="divide-y divide-border pb-2">
          {tickets.map((t) => (
            <li
              key={t.ticketId}
              className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
            >
              <RecordLink to={`/support/${t.ticketId}`} className="min-w-0 truncate">
                {ticketRef(t.ref)} {t.subject}
              </RecordLink>
              <StatusChip tone={TICKET_STATUS_TONE[t.status]}>
                {TICKET_STATUS_LABEL[t.status]}
              </StatusChip>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
