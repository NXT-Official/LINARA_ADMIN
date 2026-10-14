import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@/features/dashboard/pages/dashboard-page";

export const Route = createFileRoute("/_authed/")({
  staticData: { permission: "dashboard.view" },
  head: () => ({ meta: [{ title: "Dashboard | Linara Business Console" }] }),
  component: DashboardPage,
});
