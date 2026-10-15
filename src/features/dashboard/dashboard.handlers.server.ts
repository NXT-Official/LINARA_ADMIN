import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import type { DashboardData } from "./dashboard.types";

type DbDashboard = {
  households: number;
  households_new_7d: number;
  households_new_30d: number;
  households_active_7d: number;
  managers: number;
  managers_multi_home: number;
  helpers_active: number;
  helpers_invited: number;
  helpers_ended: number;
  new_households_weekly: { week_start: string; count: number }[];
  tasks_done_daily: { day: string; count: number }[];
};

/** Every dashboard number and both charts, in one database call (D31). */
export async function getDashboardHandler(): Promise<
  { ok: true; data: DashboardData } | PublicError
> {
  try {
    await requireStaff("dashboard.view");
    const { data, error } = await getAdminClient().rpc("staff_dashboard", {
      p_now: new Date().toISOString(),
    });
    if (error || !data) throw new Error(error?.message ?? "staff_dashboard returned nothing");
    const d = data as DbDashboard;
    return {
      ok: true,
      data: {
        households: d.households,
        householdsNew7d: d.households_new_7d,
        householdsNew30d: d.households_new_30d,
        householdsActive7d: d.households_active_7d,
        managers: d.managers,
        managersMultiHome: d.managers_multi_home,
        helpersActive: d.helpers_active,
        helpersInvited: d.helpers_invited,
        helpersEnded: d.helpers_ended,
        newHouseholdsWeekly: d.new_households_weekly.map((w) => ({
          weekStart: w.week_start,
          count: w.count,
        })),
        tasksDoneDaily: d.tasks_done_daily.map((x) => ({ day: x.day, count: x.count })),
      },
    };
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("dashboard", e);
    return toPublicError(e);
  }
}
