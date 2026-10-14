import { ConsoleError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";

import type { StaffRole } from "./permissions";
import { requireStaff } from "./session.server";

export type ConsoleSession =
  | { ok: true; staff: { userId: string; email: string; role: StaffRole } }
  | { ok: false; reason: string };

export async function getConsoleSessionHandler(): Promise<ConsoleSession> {
  try {
    const staff = await requireStaff(null);
    return { ok: true, staff: { userId: staff.userId, email: staff.email, role: staff.role } };
  } catch (e) {
    if (e instanceof ConsoleError) return { ok: false, reason: e.publicMessage };
    logError("session check", e);
    return { ok: false, reason: "Something went wrong on our side. Sign in again." };
  }
}
