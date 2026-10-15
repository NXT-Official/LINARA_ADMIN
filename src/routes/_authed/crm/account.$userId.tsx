import { createFileRoute } from "@tanstack/react-router";

import { ContactPage } from "@/features/crm/pages/contact-page";

/** A manager nobody has added anything to yet (FR-CRM-3, §5.2.1). */
export const Route = createFileRoute("/_authed/crm/account/$userId")({
  staticData: { permission: "crm.view" },
  head: () => ({ meta: [{ title: "Contact | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { userId } = Route.useParams();
  return <ContactPage key={userId} contactRef={{ userId }} />;
}
