import { ConsoleError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";

import { requireStaff } from "./session.server";
import type { SessionStaff } from "./use-can";

export type ConsoleSession = { ok: true; staff: SessionStaff } | { ok: false; reason: string };

export async function getConsoleSessionHandler(): Promise<ConsoleSession> {
  try {
    const staff = await requireStaff(null);
    return {
      ok: true,
      staff: {
        userId: staff.userId,
        email: staff.email,
        roleName: staff.roleName,
        preset: staff.preset,
        permissions: staff.permissions,
      },
    };
  } catch (e) {
    if (e instanceof ConsoleError) return { ok: false, reason: e.publicMessage };
    logError("session check", e);
    return { ok: false, reason: "Something went wrong on our side. Sign in again." };
  }
}
