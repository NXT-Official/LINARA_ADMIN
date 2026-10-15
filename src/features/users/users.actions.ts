import { createServerFn } from "@tanstack/react-start";

import { getUserHandler, listUsersHandler, type ListUsersInput } from "./users.handlers.server";

export const listUsersFn = createServerFn({ method: "GET" })
  .validator((d: ListUsersInput) => d)
  .handler(({ data }) => listUsersHandler(data));

export const getUserFn = createServerFn({ method: "GET" })
  .validator((d: { userId: string }) => d)
  .handler(({ data }) => getUserHandler(data));
