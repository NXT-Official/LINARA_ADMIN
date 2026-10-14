import { createServerFn } from "@tanstack/react-start";

import {
  listAuditHandler,
  recordExportHandler,
  type ListAuditInput,
  type RecordExportInput,
} from "./audit.handlers.server";

export const listAuditFn = createServerFn({ method: "GET" })
  .validator((d: ListAuditInput) => d)
  .handler(({ data }) => listAuditHandler(data));

export const recordExportFn = createServerFn({ method: "POST" })
  .validator((d: RecordExportInput) => d)
  .handler(({ data }) => recordExportHandler(data));
