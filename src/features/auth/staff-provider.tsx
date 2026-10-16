import type { ReactNode } from "react";

import { StaffContext, type SessionStaff } from "./use-can";

/** The signed-in member, for screens deciding which controls to show (FR-RL-8). */
export function StaffProvider({ staff, children }: { staff: SessionStaff; children: ReactNode }) {
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}
