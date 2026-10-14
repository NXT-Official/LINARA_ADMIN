import { createFileRoute } from "@tanstack/react-router";

import { SetUpTwoStepPage } from "@/features/auth/pages/set-up-two-step-page";

export const Route = createFileRoute("/sign-in/set-up")({
  head: () => ({ meta: [{ title: "Set up two-step sign-in | Linara Business Console" }] }),
  component: SetUpTwoStepPage,
});
