import { createFileRoute } from "@tanstack/react-router";

import { TwoStepPage } from "@/features/auth/pages/two-step-page";

export const Route = createFileRoute("/sign-in/two-step")({
  head: () => ({ meta: [{ title: "Enter your code | Linara Business Console" }] }),
  component: TwoStepPage,
});
