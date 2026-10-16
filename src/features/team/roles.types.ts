import type { Permission, RolePreset } from "@/features/auth/permissions";

/** A role on the Team screen's Roles tab (FR-RL-1, D39). */
export type RoleRow = {
  roleId: string;
  preset: RolePreset | null;
  name: string;
  description: string | null;
  permissions: Permission[];
  memberCount: number;
  updatedAt: string;
};

const GUARDED: readonly (RolePreset | null)[] = ["admin", "mods"];

/**
 * The roles a member may give (D39): admins give any, mods give sales, support
 * and custom roles, nobody else gives any. SQL enforces the same rule.
 */
export function assignableRoles(actorPreset: RolePreset | null, roles: RoleRow[]): RoleRow[] {
  if (actorPreset === "admin") return roles;
  if (actorPreset === "mods") return roles.filter((r) => !GUARDED.includes(r.preset));
  return [];
}

/** Whether a member's row offers Change role and Remove, and why not (FR-RL-6). */
export function canChangeMember(
  actor: { userId: string; preset: RolePreset | null },
  member: { userId: string; preset: RolePreset | null },
): { ok: true } | { ok: false; why: string } {
  if (actor.userId === member.userId) return { ok: false, why: "This is you." };
  if (actor.preset === "admin") return { ok: true };
  if (actor.preset === "mods" && !GUARDED.includes(member.preset)) return { ok: true };
  return { ok: false, why: "Only admins can change admins and mods." };
}

/** Giving any role but sales or support needs the two-step code again (D39, spec 0.19). */
export function needsCode(role: RoleRow | undefined): boolean {
  return !!role && role.preset !== "sales" && role.preset !== "support";
}
