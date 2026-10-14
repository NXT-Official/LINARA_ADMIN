import { createFileRoute } from "@tanstack/react-router";

import { ForgotPasswordPage } from "@/features/auth/pages/forgot-password-page";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password | Linara Business Console" }] }),
  component: ForgotPasswordPage,
});
