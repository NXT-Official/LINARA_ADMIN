import { createFileRoute } from "@tanstack/react-router";

import { ContactsPage } from "@/features/crm/pages/contacts-page";

export const Route = createFileRoute("/_authed/crm/")({
  head: () => ({ meta: [{ title: "CRM | Linara Business Console" }] }),
  component: ContactsPage,
});
