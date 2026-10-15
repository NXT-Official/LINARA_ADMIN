import { createServerFn } from "@tanstack/react-start";

import { getDashboardHandler } from "./dashboard.handlers.server";

export const getDashboardFn = createServerFn({ method: "GET" }).handler(() =>
  getDashboardHandler(),
);
