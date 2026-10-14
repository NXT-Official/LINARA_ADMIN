import { createFileRoute } from "@tanstack/react-router";

import { UserPage } from "@/features/users/pages/user-page";

export const Route = createFileRoute("/_authed/users/$userId")({
  staticData: { permission: "users.view" },
  head: () => ({ meta: [{ title: "User | Linara Business Console" }] }),
  component: Page,
});

function Page() {
  const { userId } = Route.useParams();
  return <UserPage userId={userId} />;
}
