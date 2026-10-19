import { createServerFn } from "@tanstack/react-start";

import { deleteFaqHandler, listFaqsHandler, saveFaqHandler } from "./faq.handlers.server";
import type { FaqInput } from "./faq.types";

export const listFaqsFn = createServerFn({ method: "GET" }).handler(() => listFaqsHandler());

export const saveFaqFn = createServerFn({ method: "POST" })
  .validator((d: FaqInput) => d)
  .handler(({ data }) => saveFaqHandler(data));

export const deleteFaqFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(({ data }) => deleteFaqHandler(data));
