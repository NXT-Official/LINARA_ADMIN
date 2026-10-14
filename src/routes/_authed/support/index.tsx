import { createFileRoute } from "@tanstack/react-router";

import { TicketsPage } from "@/features/support/pages/tickets-page";

export const Route = createFileRoute("/_authed/support/")({
  staticData: { permission: "support.view" },
  head: () => ({ meta: [{ title: "Support | Linara Business Console" }] }),
  component: TicketsPage,
});
