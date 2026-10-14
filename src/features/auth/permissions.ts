/**
 * Named permissions (spec §4.3). Screens and server functions ask for a
 * permission, never "is admin", so adding the `sales` and `support` roles later
 * means adding rows here, not rewriting screens.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "crm.view",
  "crm.write",
  "crm.export",
  "users.view",
  "households.view",
  "users.suspend",
  "deletions.view",
  "deletions.process",
  "support.view",
  "support.write",
  "pay.view",
  "payouts.view",
  "ai.view",
  "audit.view",
  "team.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** v1 has one role (D15). */
export type StaffRole = "admin";

const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: PERMISSIONS,
};

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}
