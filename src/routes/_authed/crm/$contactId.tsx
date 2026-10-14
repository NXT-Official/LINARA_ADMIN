import { createFileRoute } from "@tanstack/react-router";

import { ContactPage } from "@/features/crm/pages/contact-page";

export const Route = createFileRoute("/_authed/crm/$contactId")({
  head: () => ({ meta: [{ title: "Contact | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { contactId } = Route.useParams();
  return <ContactPage contactId={contactId} />;
}
