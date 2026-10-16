import { createHash } from "node:crypto";

import { getRequestIP } from "@tanstack/react-start/server";

import { ConsoleError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { memoryLimit } from "./memory-limit.server";

/** The shared, database-backed tier (D30). One call per check. */
export type RateRule =
  "sign_in" | "reset" | "code" | "link" | "add_admin" | "team_change" | "export";
type Kind = "email" | "ip" | "admin";

export const RATE_RULES: Record<
  RateRule,
  { windowMinutes: number; limits: { kind: Kind; max: number }[] }
> = {
  sign_in: {
    windowMinutes: 15,
    limits: [
      { kind: "email", max: 5 },
      { kind: "ip", max: 20 },
    ],
  },
  reset: {
    windowMinutes: 60,
    limits: [
      { kind: "email", max: 3 },
      { kind: "ip", max: 20 },
    ],
  },
  code: { windowMinutes: 15, limits: [{ kind: "admin", max: 5 }] },
  link: { windowMinutes: 15, limits: [{ kind: "ip", max: 10 }] },
  add_admin: { windowMinutes: 60, limits: [{ kind: "admin", max: 10 }] },
  // Creating, editing or deleting a role, or changing a member's role (D30, spec 0.20).
  team_change: { windowMinutes: 60, limits: [{ kind: "admin", max: 30 }] },
  export: { windowMinutes: 60, limits: [{ kind: "admin", max: 30 }] },
};

/** A counter key that never contains the raw email, IP or id. */
export function rateKey(kind: Kind, rule: RateRule, value: string): string {
  const hash = createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
  return `${rule}:${kind}:${hash}`;
}

export async function checkRateLimit(
  rule: RateRule,
  subjects: { email?: string; ip?: string; adminId?: string },
): Promise<void> {
  const { windowMinutes, limits } = RATE_RULES[rule];
  const value: Record<Kind, string | undefined> = {
    email: subjects.email,
    ip: subjects.ip,
    admin: subjects.adminId,
  };
  const keyed = limits
    .filter((l) => value[l.kind])
    .map((l) => ({ ...l, key: rateKey(l.kind, rule, value[l.kind] as string) }));
  if (keyed.length === 0) return;

  const { data, error } = await getAdminClient().rpc("staff_record_attempt", {
    p_keys: keyed.map((k) => k.key),
    p_window: `${windowMinutes} minutes`,
  });
  // Fail closed: an attempt we can't count isn't allowed.
  if (error) {
    logError(`rate limit ${rule}`, error.message);
    throw new ConsoleError("outside_service");
  }
  const counts = new Map(
    ((data ?? []) as { key: string; attempts: number }[]).map((r) => [r.key, r.attempts]),
  );
  if (keyed.some((k) => (counts.get(k.key) ?? 0) > k.max)) {
    throw new ConsoleError(
      "conflict",
      `Too many tries. Wait ${windowMinutes} minutes, then try again.`,
    );
  }
}

/** Free burst limit for actions before sign-in (D30, memory tier). */
export function memoryGuardIp(): void {
  if (!memoryLimit(`ip:${getRequestIP() ?? "?"}`, 30, 60_000)) {
    throw new ConsoleError("conflict", "Too many requests. Wait a minute, then try again.");
  }
}
