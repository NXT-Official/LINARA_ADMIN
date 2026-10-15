import { createFileRoute } from "@tanstack/react-router";

import { ContactPage } from "@/features/crm/pages/contact-page";

export const Route = createFileRoute("/_authed/crm/$contactId")({
  staticData: { permission: "crm.view" },
  head: () => ({ meta: [{ title: "Contact | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { contactId } = Route.useParams();
  // Keyed so moving to another contact starts fresh.
  return <ContactPage key={contactId} contactRef={{ contactId }} />;
}
