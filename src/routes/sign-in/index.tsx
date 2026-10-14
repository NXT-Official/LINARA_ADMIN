import { createFileRoute } from "@tanstack/react-router";

import { SignInPage } from "@/features/auth/pages/sign-in-page";

export const Route = createFileRoute("/sign-in/")({
  head: () => ({ meta: [{ title: "Sign in | Linara Business Console" }] }),
  component: SignInPage,
});
