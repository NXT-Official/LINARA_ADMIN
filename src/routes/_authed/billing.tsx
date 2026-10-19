import { createFileRoute } from "@tanstack/react-router";

import { BillingPage } from "@/features/billing/pages/billing-page";

// A preview on sample data (D40); money screens need pay.view until billing has its own.
export const Route = createFileRoute("/_authed/billing")({
  staticData: { permission: "pay.view" },
  head: () => ({ meta: [{ title: "Subscriptions | Linara Business Console" }] }),
  component: BillingPage,
});
