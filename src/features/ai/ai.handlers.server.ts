import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import type { AiUsage } from "./ai.types";

/** AI usage (§5.8, D38): one function call after the guard (D31). */

type DbAiUsage = {
  hourly: AiUsage["hourly"];
  top_users: { user_id: string; name: string | null; calls: number }[];
  limit_hits: {
    user_id: string;
    name: string | null;
    kind: "hourly" | "daily";
    fn: string | null;
    at: string;
  }[];
  calls_24h: number;
};

export async function aiUsageHandler(): Promise<{ ok: true; usage: AiUsage } | PublicError> {
  try {
    await requireStaff("ai.view");
    const { data, error } = await getAdminClient().rpc("staff_ai_usage", {
      p_now: new Date().toISOString(),
    });
    if (error) throw new Error(`staff_ai_usage: ${error.message}`);
    const d = data as DbAiUsage;
    return {
      ok: true,
      usage: {
        hourly: d.hourly,
        topUsers: d.top_users.map((t) => ({ userId: t.user_id, name: t.name, calls: t.calls })),
        limitHits: d.limit_hits.map((h) => ({
          userId: h.user_id,
          name: h.name,
          kind: h.kind,
          fn: h.fn,
          at: h.at,
        })),
        calls24h: d.calls_24h,
      },
    };
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("ai usage", e);
    return toPublicError(e);
  }
}
