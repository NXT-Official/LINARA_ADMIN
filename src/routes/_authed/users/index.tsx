import { createFileRoute } from "@tanstack/react-router";

import { UsersPage } from "@/features/users/pages/users-page";

export const Route = createFileRoute("/_authed/users/")({
  staticData: { permission: "users.view" },
  head: () => ({ meta: [{ title: "Users | Linara Business Console" }] }),
  component: UsersPage,
});
