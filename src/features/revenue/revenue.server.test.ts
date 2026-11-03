import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({ getAdminClient: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/log.server", () => ({ logError: vi.fn() }));

import { ConsoleError } from "@/lib/console-error";

import { loadRevenueHandler, revenueActionHandler } from "./revenue.handlers.server";
import { periodRange, pesosToCentavos } from "./revenue.logic";
import type { RevenueAction } from "./revenue.types";

const STAFF = { userId: "00000000-0000-0000-0000-000000000901" };
beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue(STAFF);
  m.rpc.mockReset().mockResolvedValue({ data: { totals: {} }, error: null });
});
const failed = (r: unknown) =>
  typeof r === "object" && r !== null && (r as { ok?: boolean }).ok === false;

describe("reading the report", () => {
  it("needs revenue.view, then asks the database for the period", async () => {
    await loadRevenueHandler({ from: "2026-10-01", to: "2026-10-31" });
    expect(m.requireStaff).toHaveBeenCalledWith("revenue.view");
    expect(m.rpc).toHaveBeenCalledWith("staff_revenue_report", {
      p_from: "2026-10-01",
      p_to: "2026-10-31",
    });
  });

  it("without the permission nothing is read", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed", "No."));
    expect(failed(await loadRevenueHandler({ from: "2026-10-01", to: "2026-10-31" }))).toBe(true);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ from: "2026-10-31", to: "2026-10-01" }],
    [{ from: "10/01/2026", to: "2026-10-31" }],
    [{ from: "2026-02-30x", to: "2026-10-31" }],
    [{ from: "'; DROP TABLE x;--", to: "2026-10-31" }],
    [null as unknown as { from: string; to: string }],
  ])("refuses dates that aren't a range: %j", async (input) => {
    expect(failed(await loadRevenueHandler(input))).toBe(true);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("costs staff enter", () => {
  it("needs revenue.manage, and sends the values as typed", async () => {
    await revenueActionHandler({ type: "set_fee_rate", channel: "GCASH", percent: 2.3, flat: 0 });
    expect(m.requireStaff).toHaveBeenCalledWith("revenue.manage");
    expect(m.rpc).toHaveBeenCalledWith("staff_revenue_set_fee_rate", {
      p_actor: STAFF.userId,
      p_channel: "GCASH",
      p_percent: 2.3,
      p_flat: 0,
    });
  });

  it("a cost's name is trimmed; the actor is the signed-in staff member, never the browser's", async () => {
    await revenueActionHandler({
      type: "add_cost",
      name: "  Supabase Pro  ",
      monthly: 125_000,
      startsOn: "2026-10-01",
      actor: "someone-else",
    } as RevenueAction);
    expect(m.rpc).toHaveBeenCalledWith("staff_revenue_add_cost", {
      p_actor: STAFF.userId,
      p_name: "Supabase Pro",
      p_monthly: 125_000,
      p_starts_on: "2026-10-01",
    });
  });

  it.each<[string, RevenueAction]>([
    ["a percent over 100", { type: "set_fee_rate", channel: "GCASH", percent: 150, flat: 0 }],
    ["a negative flat fee", { type: "set_fee_rate", channel: "GCASH", percent: 1, flat: -1 }],
    ["a channel with spaces", { type: "set_fee_rate", channel: "G CASH", percent: 1, flat: 0 }],
    ["NaN per AI call", { type: "set_ai_rate", fn: "generate-sop", perCall: Number.NaN }],
    ["a function name with SQL", { type: "set_ai_rate", fn: "x'; --", perCall: 1 }],
    [
      "a cost with no name",
      { type: "add_cost", name: "   ", monthly: 100, startsOn: "2026-10-01" },
    ],
    ["a cost of zero", { type: "add_cost", name: "x", monthly: 0, startsOn: "2026-10-01" }],
    [
      "a cost in fractions of a centavo",
      { type: "add_cost", name: "x", monthly: 1.5, startsOn: "2026-10-01" },
    ],
    ["a cost with no start", { type: "add_cost", name: "x", monthly: 100, startsOn: "" }],
    ["ending a cost that isn't an id", { type: "end_cost", id: "1", endsOn: "2026-10-01" }],
  ])("refuses %s before the database", async (_, action) => {
    expect(failed(await revenueActionHandler(action))).toBe(true);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("an unknown change is refused", async () => {
    expect(failed(await revenueActionHandler({ type: "drop" } as unknown as RevenueAction))).toBe(
      true,
    );
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("the database's refusal is passed on in its words", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That cost isn't running then." },
    });
    const r = await revenueActionHandler({
      type: "end_cost",
      id: "11111111-1111-4111-8111-111111111111",
      endsOn: "2026-10-01",
    });
    expect(r).toMatchObject({ ok: false, message: "That cost isn't running then." });
  });
});

describe("periods, in Manila", () => {
  // 20:00 UTC on Oct 28 is already Oct 29 in Manila.
  const late = new Date("2026-10-28T20:00:00Z");
  it.each([
    ["this_month", "2026-10-01", "2026-10-29"],
    ["last_month", "2026-09-01", "2026-09-30"],
    ["last_3", "2026-08-01", "2026-10-29"],
    ["last_12", "2025-11-01", "2026-10-29"],
    ["this_year", "2026-01-01", "2026-10-29"],
  ] as const)("%s", (period, from, to) => {
    expect(periodRange(period, late)).toEqual({ from, to });
  });

  it("last month from January is December of the year before", () => {
    expect(periodRange("last_month", new Date("2026-01-15T00:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("reads pesos as typed", () => {
    expect(pesosToCentavos("1,234.50")).toBe(123_450);
    expect(pesosToCentavos("₱ 99")).toBe(9_900);
    for (const bad of ["", "-5", "1.234", "abc", "1e3"]) expect(pesosToCentavos(bad)).toBeNull();
  });
});
