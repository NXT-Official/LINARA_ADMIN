import type { ReactNode } from "react";

import { StaffProvider } from "./staff-provider";

/** Preset permission lists from spec §4.2, for page tests (test-only). */
export const SALES = [
  "dashboard.view",
  "crm.view",
  "crm.write",
  "crm.export",
  "users.view",
  "households.view",
];
export const SUPPORT = [
  "dashboard.view",
  "crm.view",
  "users.view",
  "households.view",
  "deletions.view",
  "support.view",
  "support.write",
  "payouts.view",
];

/** A render wrapper that signs the page in as a member with these permissions. */
export function asRole(permissions: string[], roleName = "Custom") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StaffProvider
        staff={{ userId: "me", email: "me@example.com", roleName, preset: null, permissions }}
      >
        {children}
      </StaffProvider>
    );
  };
}
