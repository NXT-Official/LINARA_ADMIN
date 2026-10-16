import { createContext, useCallback, useContext } from "react";

import { can, type Permission, type RolePreset } from "./permissions";

export type SessionStaff = {
  userId: string;
  email: string;
  roleName: string;
  preset: RolePreset | null;
  permissions: string[];
};

/** Set by StaffProvider in the signed-in layout. */
export const StaffContext = createContext<SessionStaff | null>(null);

export function useStaff(): SessionStaff | null {
  return useContext(StaffContext);
}

/**
 * Whether the member's role allows a permission. Without a provider (a page
 * rendered on its own in a test) everything is allowed: this only hides
 * controls, and the server refuses what the role doesn't cover either way.
 */
export function useCan(): (permission: Permission) => boolean {
  const staff = useContext(StaffContext);
  return useCallback(
    (permission: Permission) => (staff ? can(staff.permissions, permission) : true),
    [staff],
  );
}
