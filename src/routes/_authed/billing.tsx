import { createFileRoute } from "@tanstack/react-router";

import { BillingPage } from "@/features/billing/pages/billing-page";

export const Route = createFileRoute("/_authed/billing")({
  staticData: { permission: "billing.view" },
  head: () => ({ meta: [{ title: "Subscriptions | Linara Business Console" }] }),
  component: BillingPage,
});
