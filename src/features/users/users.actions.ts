import { createServerFn } from "@tanstack/react-start";

import { setSuspendedHandler } from "./suspend.handlers.server";
import { getUserHandler, listUsersHandler, type ListUsersInput } from "./users.handlers.server";

export const listUsersFn = createServerFn({ method: "GET" })
  .validator((d: ListUsersInput) => d)
  .handler(({ data }) => listUsersHandler(data));

export const getUserFn = createServerFn({ method: "GET" })
  .validator((d: { userId: string }) => d)
  .handler(({ data }) => getUserHandler(data));

export const setSuspendedFn = createServerFn({ method: "POST" })
  .validator((d: { userId: string; suspended: boolean; reason: string; code: string }) => d)
  .handler(({ data }) => setSuspendedHandler(data));
