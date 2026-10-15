import { createFileRoute } from "@tanstack/react-router";

import { contactFiltersFromSearch } from "@/features/crm/crm.utils";
import { ContactsPage } from "@/features/crm/pages/contacts-page";

export const Route = createFileRoute("/_authed/crm/")({
  staticData: { permission: "crm.view" },
  head: () => ({ meta: [{ title: "CRM | Linara Business Console" }] }),
  // Dashboard figures link here with a filter already chosen (FR-DB-8).
  validateSearch: (search: Record<string, unknown>) => contactFiltersFromSearch(search),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  // Keyed so following another dashboard link starts from its filters.
  return <ContactsPage key={JSON.stringify(search)} initial={search} />;
}
