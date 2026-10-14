import { createServerFn } from "@tanstack/react-start";

import {
  addAdminHandler,
  listAdminsHandler,
  removeAdminHandler,
  type AddAdminInput,
  type RemoveAdminInput,
} from "./team.handlers.server";

export const listAdminsFn = createServerFn({ method: "GET" }).handler(() => listAdminsHandler());

export const addAdminFn = createServerFn({ method: "POST" })
  .validator((d: AddAdminInput) => d)
  .handler(({ data }) => addAdminHandler(data));

export const removeAdminFn = createServerFn({ method: "POST" })
  .validator((d: RemoveAdminInput) => d)
  .handler(({ data }) => removeAdminHandler(data));
