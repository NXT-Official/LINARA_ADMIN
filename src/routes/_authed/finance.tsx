import { createFileRoute } from "@tanstack/react-router";

import { FinancePage } from "@/features/finance/pages/finance-page";

export const Route = createFileRoute("/_authed/finance")({
  staticData: { permission: "finance.view" },
  head: () => ({ meta: [{ title: "Finance | Linara Business Console" }] }),
  component: FinancePage,
});
