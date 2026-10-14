import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/features/shell/app-shell";

// Phase 1 adds the session, two-step and role check here (spec §7.3, step 1).
export const Route = createFileRoute("/_authed")({
  // Signed-in pages render in the browser only, never on the server (S-16).
  ssr: false,
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
