import { createServerFn } from "@tanstack/react-start";

import {
  getHouseholdHandler,
  listHouseholdsHandler,
  type ListHouseholdsInput,
} from "./households.handlers.server";

export const listHouseholdsFn = createServerFn({ method: "GET" })
  .validator((d: ListHouseholdsInput) => d)
  .handler(({ data }) => listHouseholdsHandler(data));

export const getHouseholdFn = createServerFn({ method: "GET" })
  .validator((d: { householdId: string }) => d)
  .handler(({ data }) => getHouseholdHandler(data));
