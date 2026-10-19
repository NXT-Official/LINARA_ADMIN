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

/** In team rules the super admin acts as an admin (D43). */
const isAdmin = (preset: RolePreset | null) => preset === "admin" || preset === "super_admin";

/**
 * The roles a member may give (D39): the super admin gives any but its own,
 * admins give any but admin (D44), mods give sales, support and custom roles,
 * nobody else gives any. Nobody gives super admin from the console (D43). SQL
 * enforces the same rules.
 */
export function assignableRoles(actorPreset: RolePreset | null, roles: RoleRow[]): RoleRow[] {
  const giveable = roles.filter((r) => r.preset !== "super_admin");
  if (actorPreset === "super_admin") return giveable;
  if (actorPreset === "admin") return giveable.filter((r) => r.preset !== "admin");
  if (actorPreset === "mods") return giveable.filter((r) => !GUARDED.includes(r.preset));
  return [];
}

/** Whether a member's row offers Change role and Remove, and why not (FR-RL-6). */
export function canChangeMember(
  actor: { userId: string; preset: RolePreset | null },
  member: { userId: string; preset: RolePreset | null },
): { ok: true } | { ok: false; why: string } {
  if (actor.userId === member.userId) return { ok: false, why: "This is you." };
  if (member.preset === "super_admin") {
    return { ok: false, why: "The super admin can't be changed or removed." };
  }
  if (isAdmin(actor.preset)) return { ok: true };
  if (actor.preset === "mods" && !GUARDED.includes(member.preset)) return { ok: true };
  return { ok: false, why: "Only admins can change admins and mods." };
}

/** Giving any role but sales or support needs the two-step code again (D39, spec 0.19). */
export function needsCode(role: RoleRow | undefined): boolean {
  return !!role && role.preset !== "sales" && role.preset !== "support";
}
