import { createFileRoute } from "@tanstack/react-router";

import { PlansPage } from "@/features/plans/pages/plans-page";

export const Route = createFileRoute("/_authed/plans/")({
  staticData: { permission: "billing.view" },
  head: () => ({ meta: [{ title: "Plans | Linara Business Console" }] }),
  component: PlansPage,
});
