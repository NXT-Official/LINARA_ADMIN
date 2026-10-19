import { createFileRoute } from "@tanstack/react-router";

import { FaqsPage } from "@/features/faq/pages/faqs-page";

export const Route = createFileRoute("/_authed/faqs")({
  staticData: { permission: "faq.manage" },
  head: () => ({ meta: [{ title: "FAQs | Linara Business Console" }] }),
  component: FaqsPage,
});
