import { Outlet, createFileRoute, redirect, useMatches } from "@tanstack/react-router";

import { RestrictedPanel } from "@/components/shared/states";
import { getConsoleSessionFn } from "@/features/auth/session.actions";
import { can } from "@/features/auth/permissions";
import { StaffProvider } from "@/features/auth/staff-provider";
import { AppShell } from "@/features/shell/app-shell";
import "@/features/shell/route-static-data";

export const Route = createFileRoute("/_authed")({
  // Signed-in pages render in the browser only, never on the server (S-16).
  ssr: false,
  // Spec §7.3, step 1. The answer is cached for a minute, so moving between
  // screens doesn't cost a Supabase call each time (D31). The server
  // functions behind each screen still check the session themselves.
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({
      queryKey: ["console-session"],
      queryFn: () => getConsoleSessionFn(),
      staleTime: 60_000,
    });
    if (!session.ok) {
      // Ended or signed out elsewhere: drop everything cached for that session (D41).
      context.queryClient.clear();
      throw redirect({ to: "/sign-in", search: { reason: session.reason } });
    }
    return { staff: session.staff };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { staff } = Route.useRouteContext();
  const matches = useMatches();
  const permission = matches[matches.length - 1]?.staticData?.permission;

  return (
    <StaffProvider staff={staff}>
      <AppShell staff={staff}>
        {/* Spec §7.3, step 2: a screen the role doesn't cover shows Restricted (FR-RL-7). */}
        {permission && !can(staff.permissions, permission) ? <RestrictedPanel /> : <Outlet />}
      </AppShell>
    </StaffProvider>
  );
}
