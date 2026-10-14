import { createFileRoute } from "@tanstack/react-router";

import { DeletionsPage } from "@/features/deletions/pages/deletions-page";

export const Route = createFileRoute("/_authed/deletions")({
  head: () => ({ meta: [{ title: "Deletion requests | Linara Business Console" }] }),
  component: DeletionsPage,
});
