import { createFileRoute } from "@tanstack/react-router";

import { TicketPage } from "@/features/support/pages/ticket-page";

export const Route = createFileRoute("/_authed/support/$ticketId")({
  staticData: { permission: "support.view" },
  head: () => ({ meta: [{ title: "Ticket | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { ticketId } = Route.useParams();
  return <TicketPage ticketId={ticketId} />;
}
