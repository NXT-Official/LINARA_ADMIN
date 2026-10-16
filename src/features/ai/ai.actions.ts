import { createServerFn } from "@tanstack/react-start";

import { aiUsageHandler } from "./ai.handlers.server";

export const aiUsageFn = createServerFn({ method: "GET" }).handler(() => aiUsageHandler());
