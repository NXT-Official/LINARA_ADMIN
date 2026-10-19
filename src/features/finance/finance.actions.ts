import { createServerFn } from "@tanstack/react-start";

import {
  deleteCostHandler,
  getFinanceHandler,
  listCostsHandler,
  listModelPricesHandler,
  saveCostHandler,
  saveModelPriceHandler,
} from "./finance.handlers.server";
import type { CostInput, ModelPrice } from "./finance.types";

type Range = { from: string; to: string };

export const getFinanceFn = createServerFn({ method: "GET" })
  .validator((d: Range) => d)
  .handler(({ data }) => getFinanceHandler(data));

export const listCostsFn = createServerFn({ method: "GET" })
  .validator((d: Range) => d)
  .handler(({ data }) => listCostsHandler(data));

export const listModelPricesFn = createServerFn({ method: "GET" }).handler(() =>
  listModelPricesHandler(),
);

export const saveCostFn = createServerFn({ method: "POST" })
  .validator((d: CostInput) => d)
  .handler(({ data }) => saveCostHandler(data));

export const deleteCostFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(({ data }) => deleteCostHandler(data));

export const saveModelPriceFn = createServerFn({ method: "POST" })
  .validator((d: ModelPrice) => d)
  .handler(({ data }) => saveModelPriceHandler(data));
