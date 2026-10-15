import { checkRateLimit } from "@/features/auth/rate-limit.server";
import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { writeAudit } from "./audit.server";

/** The audit screen (FR-AU-1, FR-AU-2) and export records (FR-EX-3). */

const PAGE_SIZE = 50; // NFR-7
const MAX_PAGE = 200; // 10,000 entries back
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z_.]{1,40}$/;
const RECORD = /^[A-Za-z0-9_-]{1,64}$/;

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("audit", e);
    return toPublicError(e);
  }
}

/** Midnight at the start of a Manila calendar day, as an instant. */
function manilaMidnight(day: string, plusDays = 0): string {
  const t = Date.parse(`${day}T00:00:00+08:00`);
  if (Number.isNaN(t)) throw new ConsoleError("invalid_input", "Pick a valid date.");
  return new Date(t + plusDays * 86_400_000).toISOString();
}

export type AuditRow = {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  at: string;
};

export type ListAuditInput = {
  page: number;
  actorId?: string;
  action?: string;
  targetType?: string;
  /** One record's history, for its detail page. */
  targetId?: string;
  /** YYYY-MM-DD, Manila. */
  from?: string;
  to?: string;
};

export function listAuditHandler(
  input: ListAuditInput,
): Promise<{ ok: true; entries: AuditRow[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    const page = Math.max(0, Math.floor(Number(input.page) || 0));
    for (const d of [input.from, input.to]) {
      if (d && !DAY.test(d)) throw new ConsoleError("invalid_input", "Pick a valid date.");
    }
    // A deep page is a slow scan; narrow the dates instead.
    if (page > MAX_PAGE)
      throw new ConsoleError("invalid_input", "Narrow the dates to see older entries.");
    if (
      (input.actorId && !UUID.test(input.actorId)) ||
      (input.action && !NAME.test(input.action)) ||
      (input.targetType && !NAME.test(input.targetType)) ||
      (input.targetId && !RECORD.test(input.targetId))
    ) {
      throw new ConsoleError("invalid_input", "Those filters can't be used.");
    }
    await requireStaff("audit.view");

    // One more row than a page tells us whether there's a next page, without
    // a count query (D31).
    let q = getAdminClient()
      .from("staff_audit_log")
      .select("id, actor_user_id, action, target_type, target_id, reason, at");
    if (input.actorId) q = q.eq("actor_user_id", input.actorId);
    if (input.action) q = q.eq("action", input.action);
    if (input.targetType) q = q.eq("target_type", input.targetType);
    if (input.targetId) q = q.eq("target_id", input.targetId);
    if (input.from) q = q.gte("at", manilaMidnight(input.from));
    if (input.to) q = q.lt("at", manilaMidnight(input.to, 1));
    const start = page * PAGE_SIZE;
    const { data, error } = await q
      .order("at", { ascending: false })
      .range(start, start + PAGE_SIZE);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      id: number;
      actor_user_id: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      reason: string | null;
      at: string;
    }[];
    return {
      ok: true as const,
      hasMore: rows.length > PAGE_SIZE,
      entries: rows.slice(0, PAGE_SIZE).map((r) => ({
        id: String(r.id),
        actorId: r.actor_user_id,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        at: r.at,
      })),
    };
  });
}

export type RecordExportInput = { slug: string; rows: number };

export function recordExportHandler(input: RecordExportInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const slug = String(input.slug ?? "");
    const rows = Number(input.rows);
    if (!/^[a-z0-9-]{1,40}$/.test(slug) || !Number.isInteger(rows) || rows < 0 || rows > 100_000) {
      throw new ConsoleError("invalid_input", "That export can't be recorded.");
    }
    const staff = await requireStaff(null);
    await checkRateLimit("export", { adminId: staff.userId });
    await writeAudit({
      actorId: staff.userId,
      action: "export.downloaded",
      targetType: "export",
      targetId: slug,
      metadata: { rows },
    });
    return { ok: true as const };
  });
}
