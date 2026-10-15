import { createServerFn } from "@tanstack/react-start";

import { revealPayHandler, type PayField } from "./pay.handlers.server";

// POST: a reveal writes an audit entry, so it must not be cached or prefetched.
export const revealPayFn = createServerFn({ method: "POST" })
  .validator((d: { helperId: string; field: PayField }) => d)
  .handler(({ data }) => revealPayHandler(data));
