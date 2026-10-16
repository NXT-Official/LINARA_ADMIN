import { createFileRoute } from "@tanstack/react-router";

import { PayoutsPage, type PayoutFilters } from "@/features/payouts/pages/payouts-page";
import { PAYOUT_KINDS, type PayoutKind } from "@/features/payouts/payouts.types";

/** The list's starting filter from a dashboard link (FR-DB-8); anything unknown is dropped. */
function payoutFiltersFromSearch(search: Record<string, unknown>): PayoutFilters {
  const kind = search.kind as PayoutKind;
  return PAYOUT_KINDS.includes(kind) ? { kind } : {};
}

export const Route = createFileRoute("/_authed/payouts")({
  staticData: { permission: "payouts.view" },
  head: () => ({ meta: [{ title: "Payouts | Linara Business Console" }] }),
  validateSearch: (search: Record<string, unknown>) => payoutFiltersFromSearch(search),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  // Keyed so following another dashboard link starts from its filter.
  return <PayoutsPage key={JSON.stringify(search)} initial={search} />;
}
