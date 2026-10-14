import { createFileRoute } from "@tanstack/react-router";

import { PayoutsPage } from "@/features/payouts/pages/payouts-page";

export const Route = createFileRoute("/_authed/payouts")({
  staticData: { permission: "payouts.view" },
  head: () => ({ meta: [{ title: "Payouts | Linara Business Console" }] }),
  component: PayoutsPage,
});
