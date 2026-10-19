import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import {
  deleteCostHandler,
  getFinanceHandler,
  listCostsHandler,
  listModelPricesHandler,
  saveCostHandler,
  saveModelPriceHandler,
} from "./finance.handlers.server";
import { parseCostInput } from "./finance.input";
import type { CostInput, ModelPrice } from "./finance.types";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const RANGE = { from: "2026-10-01", to: "2026-10-31" };

const cost = (over: Partial<CostInput> = {}): CostInput => ({
  month: "2026-10-01",
  category: "infra",
  label: "Hosting",
  amountCentavos: 150000,
  note: null,
  ...over,
});
const price: ModelPrice = {
  model: "gpt-4o",
  inputCentavosPer1m: 14000,
  outputCentavosPer1m: 56000,
  audioCentavosPerMinute: 0,
  note: null,
};

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("every call needs finance.view", () => {
  it("getFinance maps the figures and passes the actor, range and a clock", async () => {
    m.rpc.mockResolvedValue({
      data: {
        revenue_centavos: "69700",
        cogs_centavos: 0,
        cost_entries_centavos: 0,
        ai_cost_centavos: 0,
        ai_calls: 0,
        cost_per_call_centavos: null,
        profit_centavos: 69700,
        paying_households: 1,
        users: 2,
        profit_per_user_centavos: 34850,
        series: [
          {
            month: "2026-10",
            revenue_centavos: 69700,
            cogs_centavos: 0,
            profit_centavos: 69700,
            ai_calls: 0,
          },
        ],
        ai_by_fn: [
          { fn: "chat", calls: 2, cost_centavos: 40, input_tokens: 100, output_tokens: 50 },
        ],
      },
      error: null,
    });
    const res = await getFinanceHandler(RANGE);
    expect(m.requireStaff).toHaveBeenCalledWith("finance.view");
    expect(m.rpc).toHaveBeenCalledWith(
      "billing_finance",
      expect.objectContaining({ p_actor: ME, p_from: "2026-10-01", p_to: "2026-10-31" }),
    );
    expect(res).toMatchObject({
      ok: true,
      finance: {
        revenueCentavos: 69700,
        costPerCallCentavos: null,
        profitPerUserCentavos: 34850,
        series: [{ month: "2026-10", revenueCentavos: 69700 }],
        aiByFn: [{ fn: "chat", costCentavos: 40 }],
      },
    });
  });

  it("lists costs and model prices", async () => {
    m.rpc.mockResolvedValueOnce({
      data: [
        {
          id: ID,
          month: "2026-10-01",
          category: "infra",
          label: "Hosting",
          amount_centavos: "150000",
          note: null,
        },
      ],
      error: null,
    });
    expect(await listCostsHandler(RANGE)).toMatchObject({
      ok: true,
      costs: [{ id: ID, amountCentavos: 150000 }],
    });
    expect(m.rpc).toHaveBeenCalledWith("billing_list_costs", {
      p_actor: ME,
      p_from: RANGE.from,
      p_to: RANGE.to,
    });

    m.rpc.mockResolvedValueOnce({
      data: [
        {
          model: "gpt-4o",
          input_centavos_per_1m: 14000,
          output_centavos_per_1m: "56000",
          audio_centavos_per_minute: 0,
          note: null,
        },
      ],
      error: null,
    });
    expect(await listModelPricesHandler()).toMatchObject({
      ok: true,
      prices: [{ model: "gpt-4o", outputCentavosPer1m: 56000 }],
    });
    expect(m.requireStaff).toHaveBeenCalledTimes(2);
    expect(m.requireStaff).toHaveBeenLastCalledWith("finance.view");
  });

  it("refuses without the permission and touches nothing", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    for (const res of [
      await getFinanceHandler(RANGE),
      await listCostsHandler(RANGE),
      await listModelPricesHandler(),
      await saveCostHandler(cost()),
      await deleteCostHandler({ id: ID }),
      await saveModelPriceHandler(price),
    ]) {
      expect(res).toMatchObject({ ok: false, code: "not_allowed" });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("writes", () => {
  it("saves a cost with snake_case keys, adding no id for a new one", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    const res = await saveCostHandler(cost({ label: "  Hosting  ", note: "  Vercel " }));
    expect(res).toEqual({ ok: true, costId: ID });
    expect(m.requireStaff).toHaveBeenCalledWith("finance.view");
    expect(m.rpc).toHaveBeenCalledWith("billing_save_cost", {
      p_actor: ME,
      p_cost: {
        month: "2026-10-01",
        category: "infra",
        label: "Hosting",
        amount_centavos: 150000,
        note: "Vercel",
      },
    });
  });

  it("includes the id when editing", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await saveCostHandler(cost({ id: ID }));
    expect(m.rpc.mock.calls[0]?.[1].p_cost.id).toBe(ID);
  });

  it("deletes a cost by id", async () => {
    expect(await deleteCostHandler({ id: ID })).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("billing_delete_cost", { p_actor: ME, p_id: ID });
  });

  it("saves a model price", async () => {
    expect(await saveModelPriceHandler(price)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("billing_save_model_price", {
      p_actor: ME,
      p_price: {
        model: "gpt-4o",
        input_centavos_per_1m: 14000,
        output_centavos_per_1m: 56000,
        audio_centavos_per_minute: 0,
        note: null,
      },
    });
  });
});

describe("input is validated before any I/O", () => {
  it.each([
    ["an inverted range", () => getFinanceHandler({ from: "2026-10-31", to: "2026-10-01" })],
    ["a malformed date", () => getFinanceHandler({ from: "2026-13-01", to: "2026-10-01" })],
    ["a list range with no dates", () => listCostsHandler({ from: "", to: "" })],
    ["a non-first-of-month", () => saveCostHandler(cost({ month: "2026-10-15" }))],
    ["a bad category", () => saveCostHandler(cost({ category: "rent" as never }))],
    ["a blank label", () => saveCostHandler(cost({ label: "  " }))],
    ["a fractional amount", () => saveCostHandler(cost({ amountCentavos: 10.5 }))],
    ["a negative amount", () => saveCostHandler(cost({ amountCentavos: -1 }))],
    ["a bad id", () => deleteCostHandler({ id: "nope" })],
    ["a blank model", () => saveModelPriceHandler({ ...price, model: " " })],
    ["a negative price", () => saveModelPriceHandler({ ...price, inputCentavosPer1m: -5 })],
  ])("%s", async (_name, run) => {
    const res = await run();
    expect(res).toMatchObject({ ok: false });
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("answers invalid_input for a bad cost", () => {
    expect(() => parseCostInput(cost({ label: "" }))).toThrow(ConsoleError);
    try {
      parseCostInput(cost({ label: "" }));
    } catch (e) {
      expect((e as ConsoleError).code).toBe("invalid_input");
    }
  });
});

describe("database errors", () => {
  it("turns a plain-sentence refusal into a conflict with that sentence", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That cost doesn't exist." },
    });
    expect(await deleteCostHandler({ id: ID })).toEqual({
      ok: false,
      code: "conflict",
      message: "That cost doesn't exist.",
    });
  });

  it("says outside_service when the function is missing, without leaking it", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function public.billing_finance(...) does not exist" },
    });
    const res = await getFinanceHandler(RANGE);
    expect(res).toMatchObject({ ok: false, code: "outside_service" });
    expect(JSON.stringify(res)).not.toContain("billing_finance");
  });

  it("hides any other database error", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret detail" } });
    const res = await listModelPricesHandler();
    expect(res).toMatchObject({ ok: false, code: "outside_service" });
    expect(JSON.stringify(res)).not.toContain("secret");
  });
});
