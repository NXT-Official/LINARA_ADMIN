import { createFileRoute } from "@tanstack/react-router";

import { ImportPage } from "@/features/crm/pages/import-page";

export const Route = createFileRoute("/_authed/crm/import")({
  staticData: { permission: "crm.write" },
  head: () => ({ meta: [{ title: "Import leads | Linara Business Console" }] }),
  component: ImportPage,
});
