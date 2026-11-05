import { createServerFn } from "@tanstack/react-start";

import { loadRevenueHandler, revenueActionHandler } from "./revenue.handlers.server";
import type { RevenueAction } from "./revenue.types";

export const loadRevenueFn = createServerFn({ method: "GET" })
  .validator((d: { from: string; to: string }) => d)
  .handler(({ data }) => loadRevenueHandler(data));

export const revenueActionFn = createServerFn({ method: "POST" })
  .validator((d: RevenueAction) => d)
  .handler(({ data }) => revenueActionHandler(data));
