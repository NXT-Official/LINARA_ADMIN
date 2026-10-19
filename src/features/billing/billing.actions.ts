import { createServerFn } from "@tanstack/react-start";

import {
  getHouseholdBillingHandler,
  grantPlanHandler,
  markInvoicePaidHandler,
  revokeSubscriptionHandler,
} from "./billing.handlers.server";
import type { GrantInput, MarkPaidInput, RevokeInput } from "./billing.input";

export const getHouseholdBillingFn = createServerFn({ method: "GET" })
  .validator((d: { householdId: string }) => d)
  .handler(({ data }) => getHouseholdBillingHandler(data));

export const grantPlanFn = createServerFn({ method: "POST" })
  .validator((d: GrantInput) => d)
  .handler(({ data }) => grantPlanHandler(data));

export const markInvoicePaidFn = createServerFn({ method: "POST" })
  .validator((d: MarkPaidInput) => d)
  .handler(({ data }) => markInvoicePaidHandler(data));

export const revokeSubscriptionFn = createServerFn({ method: "POST" })
  .validator((d: RevokeInput) => d)
  .handler(({ data }) => revokeSubscriptionHandler(data));
