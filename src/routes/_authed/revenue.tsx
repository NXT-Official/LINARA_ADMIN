import { createFileRoute } from "@tanstack/react-router";

import { RevenuePage } from "@/features/revenue/pages/revenue-page";

export const Route = createFileRoute("/_authed/revenue")({
  staticData: { permission: "revenue.view" },
  head: () => ({ meta: [{ title: "Revenue | Linara Business Console" }] }),
  component: RevenuePage,
});
