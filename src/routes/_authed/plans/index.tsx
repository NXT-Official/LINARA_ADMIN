import { createFileRoute } from "@tanstack/react-router";

import { PlansPage } from "@/features/plans/pages/plans-page";

// A preview on sample data (D47); money screens need pay.view until billing has its own.
export const Route = createFileRoute("/_authed/plans/")({
  staticData: { permission: "pay.view" },
  head: () => ({ meta: [{ title: "Plans | Linara Business Console" }] }),
  component: PlansPage,
});
