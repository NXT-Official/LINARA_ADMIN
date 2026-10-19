import { createServerFn } from "@tanstack/react-start";

import {
  getBillingSettingsHandler,
  listPlansHandler,
  saveBillingSettingsHandler,
  savePlanHandler,
  setPlanStatusHandler,
} from "./plans.handlers.server";
import type { BillingSettings, PlanInput, PlanStatus } from "./plans.types";

export const listPlansFn = createServerFn({ method: "GET" }).handler(() => listPlansHandler());

export const getBillingSettingsFn = createServerFn({ method: "GET" }).handler(() =>
  getBillingSettingsHandler(),
);

export const savePlanFn = createServerFn({ method: "POST" })
  .validator((d: PlanInput) => d)
  .handler(({ data }) => savePlanHandler(data));

export const setPlanStatusFn = createServerFn({ method: "POST" })
  .validator((d: { planId: string; status: PlanStatus }) => d)
  .handler(({ data }) => setPlanStatusHandler(data));

export const saveBillingSettingsFn = createServerFn({ method: "POST" })
  .validator((d: BillingSettings) => d)
  .handler(({ data }) => saveBillingSettingsHandler(data));
