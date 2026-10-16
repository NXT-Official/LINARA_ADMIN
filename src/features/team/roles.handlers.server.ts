import { PERMISSIONS, type Permission, type RolePreset } from "@/features/auth/permissions";
import { checkRateLimit } from "@/features/auth/rate-limit.server";
import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import type { RoleRow } from "./roles.types";

/** Roles and member roles (FR-RL-1 to FR-RL-6, D39): SQL enforces the rules and audits. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("roles", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    // Races SQL can't word: the role went away (foreign key), or the name was just taken.
    if (error.code === "23503") throw new ConsoleError("conflict", "That role doesn't exist.");
    if (error.code === "23505") {
      throw new ConsoleError("conflict", "A role with that name already exists.");
    }
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

const bad = (message: string) => new ConsoleError("invalid_input", message);
const NO_ROLE = "That role doesn't exist.";

export type RoleInput = { name: string; description: string; permissions: string[] };

/** Trimmed and limited as SQL will (FR-RL-3), so a bad form never reaches it. */
function parseRole(input: RoleInput) {
  const name = String(input.name ?? "").trim();
  if (name.length < 1 || name.length > 40) throw bad("Give the role a name of 1 to 40 characters.");
  const description = String(input.description ?? "").trim();
  if (description.length > 200) throw bad("Keep the description to 200 characters.");
  const list = Array.isArray(input.permissions) ? input.permissions : [];
  if (!list.every((p) => (PERMISSIONS as readonly string[]).includes(p))) {
    throw bad("Pick permissions from the list.");
  }
  const permissions = [...new Set(list)].sort() as Permission[];
  return { name, description: description || null, permissions };
}

type DbRole = {
  role_id: string;
  preset: RolePreset | null;
  name: string;
  description: string | null;
  permissions: Permission[];
  member_count: number;
  updated_at: string;
};

export function listRolesHandler(): Promise<{ ok: true; roles: RoleRow[] } | PublicError> {
  return run(async () => {
    await requireStaff("team.manage");
    const rows = await call<DbRole[]>("staff_list_roles", {});
    return {
      ok: true as const,
      roles: (rows ?? []).map((r) => ({
        roleId: r.role_id,
        preset: r.preset,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        memberCount: r.member_count,
        updatedAt: r.updated_at,
      })),
    };
  });
}

/** Creating a role is new access, so it needs the code (spec 0.19); SQL refuses without it. */
export function createRoleHandler(
  input: RoleInput & { code?: string },
): Promise<{ ok: true; roleId: string } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    const role = parseRole(input);
    await checkRateLimit("team_change", { adminId: staff.userId });
    if (input.code) await requireFreshCode(staff, input.code);
    const roleId = await call<string>("staff_create_role", {
      p_actor: staff.userId,
      p_name: role.name,
      p_description: role.description,
      p_permissions: role.permissions,
      p_code_checked: !!input.code,
    });
    return { ok: true as const, roleId };
  });
}

export type UpdateRoleInput = RoleInput & { roleId: string; seenUpdatedAt: string; code?: string };

export function updateRoleHandler(input: UpdateRoleInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    if (!isUuid(input.roleId)) throw new ConsoleError("not_found", NO_ROLE);
    const role = parseRole(input);
    await checkRateLimit("team_change", { adminId: staff.userId });
    if (input.code) await requireFreshCode(staff, input.code);
    await call("staff_update_role", {
      p_actor: staff.userId,
      p_role_id: input.roleId,
      p_name: role.name,
      p_description: role.description,
      p_permissions: role.permissions,
      p_seen_updated_at: input.seenUpdatedAt,
      p_code_checked: !!input.code,
    });
    return { ok: true as const };
  });
}

export function deleteRoleHandler(input: { roleId: string }): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    if (!isUuid(input.roleId)) throw new ConsoleError("not_found", NO_ROLE);
    await checkRateLimit("team_change", { adminId: staff.userId });
    await call("staff_delete_role", { p_actor: staff.userId, p_role_id: input.roleId });
    return { ok: true as const };
  });
}

export type SetMemberRoleInput = { userId: string; roleId: string; code?: string };

export function setMemberRoleHandler(
  input: SetMemberRoleInput,
): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    if (!isUuid(input.userId))
      throw new ConsoleError("not_found", "That person isn't on the team.");
    if (!isUuid(input.roleId)) throw bad("Pick a role.");
    await checkRateLimit("team_change", { adminId: staff.userId });
    if (input.code) await requireFreshCode(staff, input.code);
    await call("staff_set_member_role", {
      p_actor: staff.userId,
      p_user_id: input.userId,
      p_role_id: input.roleId,
      p_code_checked: !!input.code,
    });
    return { ok: true as const };
  });
}
