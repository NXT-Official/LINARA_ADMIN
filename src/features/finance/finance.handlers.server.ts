import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { costId, parseCostInput, parseModelPrice, parseRange } from "./finance.input";
import {
  costFromDb,
  financeFromDb,
  modelPriceFromDb,
  type Cost,
  type CostInput,
  type DbCost,
  type DbFinance,
  type DbModelPrice,
  type Finance,
  type ModelPrice,
} from "./finance.types";

/**
 * Finance: figures, costs and model prices. All of it is finance management,
 * so every call needs finance.view; there is no separate write permission.
 */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("finance", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    // The finance SQL (018) isn't applied yet: say it's on our side, not the admin's.
    if (/function .* does not exist/i.test(error.message)) {
      logError("finance", new Error(`${fn}: ${error.message}`));
      throw new ConsoleError("outside_service");
    }
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

type Done = { ok: true } | PublicError;

export function getFinanceHandler(input: {
  from: string;
  to: string;
}): Promise<{ ok: true; finance: Finance } | PublicError> {
  return run(async () => {
    const { from, to } = parseRange(input);
    const staff = await requireStaff("finance.view");
    const row = await call<DbFinance | null>("billing_finance", {
      p_actor: staff.userId,
      p_from: from,
      p_to: to,
      p_now: new Date().toISOString(),
    });
    if (!row) throw new Error("billing_finance returned nothing");
    return { ok: true as const, finance: financeFromDb(row) };
  });
}

export function listCostsHandler(input: {
  from: string;
  to: string;
}): Promise<{ ok: true; costs: Cost[] } | PublicError> {
  return run(async () => {
    const { from, to } = parseRange(input);
    const staff = await requireStaff("finance.view");
    const rows = await call<DbCost[] | null>("billing_list_costs", {
      p_actor: staff.userId,
      p_from: from,
      p_to: to,
    });
    return { ok: true as const, costs: (rows ?? []).map(costFromDb) };
  });
}

export function listModelPricesHandler(): Promise<
  { ok: true; prices: ModelPrice[] } | PublicError
> {
  return run(async () => {
    const staff = await requireStaff("finance.view");
    const rows = await call<DbModelPrice[] | null>("billing_list_model_prices", {
      p_actor: staff.userId,
    });
    return { ok: true as const, prices: (rows ?? []).map(modelPriceFromDb) };
  });
}

export function saveCostHandler(
  input: CostInput,
): Promise<{ ok: true; costId: string } | PublicError> {
  return run(async () => {
    const c = parseCostInput(input);
    const staff = await requireStaff("finance.view");
    const id = await call<string>("billing_save_cost", {
      p_actor: staff.userId,
      p_cost: {
        ...(c.id === undefined ? {} : { id: c.id }),
        month: c.month,
        category: c.category,
        label: c.label,
        amount_centavos: c.amountCentavos,
        note: c.note,
      },
    });
    return { ok: true as const, costId: id };
  });
}

export function deleteCostHandler(input: { id: string }): Promise<Done> {
  return run(async () => {
    const id = costId(input?.id);
    const staff = await requireStaff("finance.view");
    await call("billing_delete_cost", { p_actor: staff.userId, p_id: id });
    return { ok: true as const };
  });
}

export function saveModelPriceHandler(input: ModelPrice): Promise<Done> {
  return run(async () => {
    const p = parseModelPrice(input);
    const staff = await requireStaff("finance.view");
    await call("billing_save_model_price", {
      p_actor: staff.userId,
      p_price: {
        model: p.model,
        input_centavos_per_1m: p.inputCentavosPer1m,
        output_centavos_per_1m: p.outputCentavosPer1m,
        audio_centavos_per_minute: p.audioCentavosPerMinute,
        note: p.note,
      },
    });
    return { ok: true as const };
  });
}
