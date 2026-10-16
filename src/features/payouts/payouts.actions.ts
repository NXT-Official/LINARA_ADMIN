import { createServerFn } from "@tanstack/react-start";

import {
  listPayoutProblemsHandler,
  payoutCountsHandler,
  type ListPayoutProblemsInput,
} from "./payouts.handlers.server";

export const listPayoutProblemsFn = createServerFn({ method: "GET" })
  .validator((d: ListPayoutProblemsInput) => d)
  .handler(({ data }) => listPayoutProblemsHandler(data));

export const payoutCountsFn = createServerFn({ method: "GET" }).handler(() =>
  payoutCountsHandler(),
);
