import { createServerFn } from "@tanstack/react-start";

import { getConsoleSessionHandler } from "./session.handlers.server";

/** Who is signed in, for the route guard. Every server function still checks for itself. */
export const getConsoleSessionFn = createServerFn({ method: "GET" }).handler(() =>
  getConsoleSessionHandler(),
);
