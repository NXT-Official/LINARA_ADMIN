import { createServerFn } from "@tanstack/react-start";

import {
  deletionCountsHandler,
  listDeletionsHandler,
  processDeletionHandler,
} from "./deletions.handlers.server";
import type { DeletionView } from "./deletions.types";

export const listDeletionsFn = createServerFn({ method: "GET" })
  .validator((d: { view: DeletionView; page: number }) => d)
  .handler(({ data }) => listDeletionsHandler(data));

export const deletionCountsFn = createServerFn({ method: "GET" }).handler(() =>
  deletionCountsHandler(),
);

export const processDeletionFn = createServerFn({ method: "POST" })
  .validator((d: { requestId: string; code: string }) => d)
  .handler(({ data }) => processDeletionHandler(data));
