import { createFileRoute } from "@tanstack/react-router";

import { PlanPage } from "@/features/plans/pages/plan-page";

export const Route = createFileRoute("/_authed/plans/$planId")({
  staticData: { permission: "billing.view" },
  head: () => ({ meta: [{ title: "Plan | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { planId } = Route.useParams();
  return <PlanPage planId={planId} />;
}
