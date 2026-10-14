import type { AuditEntry } from "@/data/types";
import { ConsoleError } from "@/lib/console-error";
import { logError, scrub } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

export type AuditInput = {
  actorId: string;
  action: string;
  targetType: AuditEntry["targetType"] | "auth";
  targetId: string;
  reason?: string | null;
  metadata?: Record<string, string | number | boolean>;
};

/** The audit log stores ids, never names, emails, phones or amounts (S-22). */
export function assertNoPersonalData(metadata: AuditInput["metadata"]): void {
  for (const value of Object.values(metadata ?? {})) {
    if (typeof value === "string" && scrub(value) !== value) {
      throw new Error("personal data in audit metadata");
    }
  }
}

/**
 * Writes one audit entry. If it can't be written the action fails too, so
 * nothing in the console happens without a record (NFR-9).
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  assertNoPersonalData(input.metadata);
  const { error } = await getAdminClient()
    .from("staff_audit_log")
    .insert({
      actor_user_id: input.actorId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  if (error) {
    logError("audit write", error.message);
    throw new ConsoleError("outside_service");
  }
}
