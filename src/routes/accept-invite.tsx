import { createFileRoute } from "@tanstack/react-router";

import { SetPasswordForm } from "@/features/auth/components/set-password-form";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Welcome | Linara Business Console" }] }),
  component: () => <SetPasswordForm purpose="invite" />,
});
