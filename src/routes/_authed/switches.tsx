import { createFileRoute } from "@tanstack/react-router";

import { SwitchesPage } from "@/features/plans/pages/switches-page";

// A preview on sample data (D47) until switches.manage exists (plan R16).
export const Route = createFileRoute("/_authed/switches")({
  staticData: { permission: "switches.manage" },
  head: () => ({ meta: [{ title: "Global switches | Linara Business Console" }] }),
  component: SwitchesPage,
});
