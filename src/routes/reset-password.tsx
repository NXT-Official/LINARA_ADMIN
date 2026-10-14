import { createFileRoute } from "@tanstack/react-router";

import { SetPasswordForm } from "@/features/auth/components/set-password-form";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Choose a new password | Linara Business Console" }] }),
  component: () => <SetPasswordForm purpose="recovery" />,
});
