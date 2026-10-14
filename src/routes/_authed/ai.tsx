import { createFileRoute } from "@tanstack/react-router";

import { AiUsagePage } from "@/features/ai/pages/ai-usage-page";

export const Route = createFileRoute("/_authed/ai")({
  staticData: { permission: "ai.view" },
  head: () => ({ meta: [{ title: "AI usage | Linara Business Console" }] }),
  component: AiUsagePage,
});
