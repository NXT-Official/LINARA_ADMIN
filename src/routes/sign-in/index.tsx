import { createFileRoute } from "@tanstack/react-router";

import { SignInPage } from "@/features/auth/pages/sign-in-page";

export const Route = createFileRoute("/sign-in/")({
  // A plain message to show above the form, e.g. after an idle sign-out. Rendered as text.
  validateSearch: (s: Record<string, unknown>): { reason?: string } =>
    typeof s.reason === "string" ? { reason: s.reason.slice(0, 200) } : {},
  head: () => ({ meta: [{ title: "Sign in | Linara Business Console" }] }),
  component: function SignInRoute() {
    const { reason } = Route.useSearch();
    return <SignInPage reason={reason} />;
  },
});
