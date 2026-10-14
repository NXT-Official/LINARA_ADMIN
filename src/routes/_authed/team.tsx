import { createFileRoute } from "@tanstack/react-router";

import { TeamPage } from "@/features/team/pages/team-page";

export const Route = createFileRoute("/_authed/team")({
  staticData: { permission: "team.manage" },
  head: () => ({ meta: [{ title: "Admins | Linara Business Console" }] }),
  component: TeamPage,
});
