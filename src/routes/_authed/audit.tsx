import { createFileRoute } from "@tanstack/react-router";

import { AuditPage } from "@/features/audit/pages/audit-page";

export const Route = createFileRoute("/_authed/audit")({
  head: () => ({ meta: [{ title: "Audit log | Linara Business Console" }] }),
  component: AuditPage,
});
