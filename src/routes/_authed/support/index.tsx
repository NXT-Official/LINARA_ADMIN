import { createFileRoute } from "@tanstack/react-router";

import { TicketsPage, type TicketFilters } from "@/features/support/pages/tickets-page";

const STATUSES = ["active", "open", "pending", "resolved", "closed"];

/** The list's starting filters from a dashboard link (FR-DB-8); anything unknown is dropped. */
function ticketFiltersFromSearch(search: Record<string, unknown>): TicketFilters {
  return {
    ...(STATUSES.includes(search.status as string)
      ? { status: search.status as TicketFilters["status"] }
      : {}),
    ...(search.assignee === "mine" || search.assignee === "unassigned"
      ? { assignee: search.assignee }
      : {}),
  };
}

export const Route = createFileRoute("/_authed/support/")({
  staticData: { permission: "support.view" },
  head: () => ({ meta: [{ title: "Support | Linara Business Console" }] }),
  validateSearch: (search: Record<string, unknown>) => ticketFiltersFromSearch(search),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  // Keyed so following another dashboard link starts from its filters.
  return <TicketsPage key={JSON.stringify(search)} initial={search} />;
}
