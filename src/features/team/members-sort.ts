import type { RolePreset } from "@/features/auth/permissions";

import type { AdminRow } from "./team.handlers.server";

export type MemberSort = "role" | "email" | "signIn" | "added";

const RANK: Record<RolePreset, number> = {
  super_admin: 0,
  admin: 1,
  mods: 2,
  sales: 3,
  support: 4,
};
const rank = (preset: RolePreset | null) => (preset ? RANK[preset] : 5);
const byEmail = (a: AdminRow, b: AdminRow) => a.email.localeCompare(b.email);
const newest = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

/**
 * The Members tab's order. By role: most access first (super admin, admin,
 * mods, sales, support, then custom roles by name). Last sign-in and added:
 * newest first, never-signed-in last. Ties go by email.
 */
export function sortMembers(members: AdminRow[], by: MemberSort): AdminRow[] {
  const sorted = [...members];
  sorted.sort((a, b) => {
    const order =
      by === "role"
        ? rank(a.preset) - rank(b.preset) || a.roleName.localeCompare(b.roleName)
        : by === "signIn"
          ? newest(a.lastSignInAt, b.lastSignInAt)
          : by === "added"
            ? newest(a.addedAt, b.addedAt)
            : 0;
    return order || byEmail(a, b);
  });
  return sorted;
}
