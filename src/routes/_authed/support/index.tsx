import { createFileRoute } from "@tanstack/react-router";

import { TicketsPage } from "@/features/support/pages/tickets-page";

export const Route = createFileRoute("/_authed/support/")({
  head: () => ({ meta: [{ title: "Support | Linara Business Console" }] }),
  component: TicketsPage,
});
