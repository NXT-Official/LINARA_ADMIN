import { createFileRoute } from "@tanstack/react-router";

import { HouseholdPage } from "@/features/households/pages/household-page";

export const Route = createFileRoute("/_authed/households/$householdId")({
  staticData: { permission: "households.view" },
  head: () => ({ meta: [{ title: "Household | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { householdId } = Route.useParams();
  return <HouseholdPage householdId={householdId} />;
}
