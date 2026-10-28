import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { checkAction, isDate } from "./revenue.logic";
import type { RevenueAction, RevenueReport } from "./revenue.types";

/**
 * Revenue (D49, 019-revenue.sql): one read for the screen, and the costs staff
 * enter. Every call checks the session, aal2 and the permission first
 * (requireStaff); the database checks each value again.
 */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("revenue", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

const bad = (message: string) => new ConsoleError("invalid_input", message);

/** The report for a period, Manila dates, both included. */
export function loadRevenueHandler(input: {
  from: string;
  to: string;
}): Promise<RevenueReport | PublicError> {
  return run(async () => {
    await requireStaff("revenue.view");
    if (!isDate(input?.from) || !isDate(input?.to)) throw bad("Choose the dates to report on.");
    if (input.to < input.from) throw bad("Choose a start date on or before the end date.");
    return call<RevenueReport>("staff_revenue_report", { p_from: input.from, p_to: input.to });
  });
}

/** A fee rate, an AI call cost, or a fixed cost added or ended. */
export function revenueActionHandler(action: RevenueAction): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("revenue.manage");
    if (!action || typeof action !== "object") throw bad("Unknown change.");
    const why = checkAction(action);
    if (why) throw bad(why);
    const actor = staff.userId;
    switch (action.type) {
      case "set_fee_rate":
        await call("staff_revenue_set_fee_rate", {
          p_actor: actor,
          p_channel: action.channel,
          p_percent: action.percent,
          p_flat: action.flat,
        });
        break;
      case "set_ai_rate":
        await call("staff_revenue_set_ai_rate", {
          p_actor: actor,
          p_fn: action.fn,
          p_per_call: action.perCall,
        });
        break;
      case "add_cost":
        await call("staff_revenue_add_cost", {
          p_actor: actor,
          p_name: action.name.trim(),
          p_monthly: action.monthly,
          p_starts_on: action.startsOn,
        });
        break;
      case "end_cost":
        await call("staff_revenue_end_cost", {
          p_actor: actor,
          p_id: action.id,
          p_ends_on: action.endsOn,
        });
        break;
      default:
        throw bad("Unknown change.");
    }
    return { ok: true as const };
  });
}
