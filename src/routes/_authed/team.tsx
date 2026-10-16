import { createFileRoute } from "@tanstack/react-router";

import { TeamPage, type TeamTab } from "@/features/team/pages/team-page";

/** The tab to open, e.g. from a role's audit entry (FR-AU-2); anything else is Members. */
function teamSearch(search: Record<string, unknown>): { tab?: TeamTab } {
  return search.tab === "roles" ? { tab: "roles" } : {};
}

export const Route = createFileRoute("/_authed/team")({
  staticData: { permission: "team.manage" },
  head: () => ({ meta: [{ title: "Team | Linara Business Console" }] }),
  validateSearch: (search: Record<string, unknown>) => teamSearch(search),
  component: Page,
});

function Page() {
  const { tab } = Route.useSearch();
  return <TeamPage key={tab ?? "members"} tab={tab} />;
}
