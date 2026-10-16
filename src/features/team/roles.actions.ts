import { createServerFn } from "@tanstack/react-start";

import {
  createRoleHandler,
  deleteRoleHandler,
  listRolesHandler,
  setMemberRoleHandler,
  updateRoleHandler,
  type RoleInput,
  type SetMemberRoleInput,
  type UpdateRoleInput,
} from "./roles.handlers.server";

export const listRolesFn = createServerFn({ method: "GET" }).handler(() => listRolesHandler());

export const createRoleFn = createServerFn({ method: "POST" })
  .validator((d: RoleInput & { code?: string }) => d)
  .handler(({ data }) => createRoleHandler(data));

export const updateRoleFn = createServerFn({ method: "POST" })
  .validator((d: UpdateRoleInput) => d)
  .handler(({ data }) => updateRoleHandler(data));

export const deleteRoleFn = createServerFn({ method: "POST" })
  .validator((d: { roleId: string }) => d)
  .handler(({ data }) => deleteRoleHandler(data));

export const setMemberRoleFn = createServerFn({ method: "POST" })
  .validator((d: SetMemberRoleInput) => d)
  .handler(({ data }) => setMemberRoleHandler(data));
