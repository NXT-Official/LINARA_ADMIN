import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { parseBillingSettings, parsePlanInput, parsePlanStatus, planId } from "./plans.input";
import {
  planFromDb,
  settingsFromDb,
  type BillingSettings,
  type DbPlan,
  type DbSettings,
  type Plan,
  type PlanInput,
  type PlanStatus,
} from "./plans.types";

/** Plans and the free tier: one function call each after the guard. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("plans", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    // The billing SQL (016) isn't applied yet: say it's on our side, not the admin's.
    if (/function .* does not exist/i.test(error.message)) {
      logError("plans", new Error(`${fn}: ${error.message}`));
      throw new ConsoleError("outside_service");
    }
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

type Done = { ok: true } | PublicError;

// ---------------------------------------------------------------- Reads (billing.view)

export function listPlansHandler(): Promise<{ ok: true; plans: Plan[] } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("billing.view");
    const rows = await call<DbPlan[] | null>("billing_list_plans", { p_actor: staff.userId });
    return { ok: true as const, plans: (rows ?? []).map(planFromDb) };
  });
}

export function getBillingSettingsHandler(): Promise<
  { ok: true; settings: BillingSettings } | PublicError
> {
  return run(async () => {
    const staff = await requireStaff("billing.view");
    const row = await call<DbSettings | null>("billing_get_settings", { p_actor: staff.userId });
    if (!row) throw new Error("billing_get_settings returned nothing");
    return { ok: true as const, settings: settingsFromDb(row) };
  });
}

// ---------------------------------------------------------------- Writes (billing.manage)

export function savePlanHandler(
  input: PlanInput,
): Promise<{ ok: true; planId: string } | PublicError> {
  return run(async () => {
    const p = parsePlanInput(input);
    const staff = await requireStaff("billing.manage");
    const id = await call<string>("billing_save_plan", {
      p_actor: staff.userId,
      p_plan: {
        ...(p.id === undefined ? {} : { id: p.id }),
        name: p.name,
        tagline: p.tagline,
        inclusions: p.inclusions,
        interval: p.interval,
        base_centavos: p.baseCentavos,
        included_helpers: p.includedHelpers,
        included_managers: p.includedManagers,
        included_homes: p.includedHomes,
        extra_helper_centavos: p.extraHelperCentavos,
        extra_manager_centavos: p.extraManagerCentavos,
        extra_home_centavos: p.extraHomeCentavos,
        trial_days: p.trialDays,
        is_public: p.isPublic,
        sort_order: p.sortOrder,
      },
    });
    return { ok: true as const, planId: id };
  });
}

export function setPlanStatusHandler(input: { planId: string; status: PlanStatus }): Promise<Done> {
  return run(async () => {
    const id = planId(input.planId);
    const status = parsePlanStatus(input.status);
    const staff = await requireStaff("billing.manage");
    await call("billing_set_plan_status", {
      p_actor: staff.userId,
      p_plan_id: id,
      p_status: status,
    });
    return { ok: true as const };
  });
}

export function saveBillingSettingsHandler(input: BillingSettings): Promise<Done> {
  return run(async () => {
    const s = parseBillingSettings(input);
    const staff = await requireStaff("billing.manage");
    await call("billing_save_settings", {
      p_actor: staff.userId,
      p_settings: {
        free_tier_enabled: s.freeTierEnabled,
        free_helper_seats: s.freeHelperSeats,
        free_manager_seats: s.freeManagerSeats,
        support_email: s.supportEmail,
      },
    });
    return { ok: true as const };
  });
}
