import { createFileRoute } from "@tanstack/react-router";

import { HouseholdsPage } from "@/features/households/pages/households-page";

export const Route = createFileRoute("/_authed/households/")({
  staticData: { permission: "households.view" },
  head: () => ({ meta: [{ title: "Households | Linara Business Console" }] }),
  component: HouseholdsPage,
});
