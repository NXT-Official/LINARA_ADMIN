import { createServerFn } from "@tanstack/react-start";

import type { CatalogAction } from "@/features/plans/plans.logic";

import {
  billingActionHandler,
  catalogActionHandler,
  loadBillingHandler,
  testShiftHandler,
} from "./billing.handlers.server";
import type { BillingAction } from "./billing.logic";

export const loadBillingFn = createServerFn({ method: "GET" }).handler(() => loadBillingHandler());

export const catalogActionFn = createServerFn({ method: "POST" })
  .validator((d: { action: CatalogAction; code?: string }) => d)
  .handler(({ data }) => catalogActionHandler(data));

export const billingActionFn = createServerFn({ method: "POST" })
  .validator((d: BillingAction) => d)
  .handler(({ data }) => billingActionHandler(data));

export const testShiftFn = createServerFn({ method: "POST" })
  .validator((d: { subscriptionId: string; days: number }) => d)
  .handler(({ data }) => testShiftHandler(data));
