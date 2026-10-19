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
  getBillingSettingsHandler,
  listPlansHandler,
  saveBillingSettingsHandler,
  savePlanHandler,
  setPlanStatusHandler,
} from "./plans.handlers.server";
import { parsePlanInput } from "./plans.input";
import { examplePlan } from "./plans.test-utils";
import type { PlanInput } from "./plans.types";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";

const input = (over: Partial<PlanInput> = {}): PlanInput => {
  const { id: _id, status: _status, ...rest } = examplePlan();
  return { ...rest, ...over };
};

const dbPlan = {
  id: ID,
  name: "Home",
  tagline: "",
  inclusions: ["One"],
  interval: "monthly",
  base_centavos: "49900",
  included_helpers: 1,
  included_managers: null,
  included_homes: null,
  extra_helper_centavos: 9900,
  extra_manager_centavos: null,
  extra_home_centavos: null,
  trial_days: 7,
  is_public: true,
  status: "draft",
  sort_order: 2,
};

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("reads need billing.view", () => {
  it("lists plans for the actor and maps them to centavos", async () => {
    m.rpc.mockResolvedValue({ data: [dbPlan], error: null });
    const res = await listPlansHandler();
    expect(m.requireStaff).toHaveBeenCalledWith("billing.view");
    expect(m.rpc).toHaveBeenCalledWith("billing_list_plans", { p_actor: ME });
    expect(res).toMatchObject({
      ok: true,
      plans: [{ id: ID, baseCentavos: 49900, includedManagers: null, trialDays: 7 }],
    });
  });

  it("reads the free-tier settings", async () => {
    m.rpc.mockResolvedValue({
      data: {
        free_tier_enabled: true,
        free_helper_seats: 1,
        free_manager_seats: null,
        support_email: "help@x.com",
      },
      error: null,
    });
    const res = await getBillingSettingsHandler();
    expect(m.requireStaff).toHaveBeenCalledWith("billing.view");
    expect(m.rpc).toHaveBeenCalledWith("billing_get_settings", { p_actor: ME });
    expect(res).toEqual({
      ok: true,
      settings: {
        freeTierEnabled: true,
        freeHelperSeats: 1,
        freeManagerSeats: null,
        supportEmail: "help@x.com",
      },
    });
  });

  it("refuses without the permission and never calls the database", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(listPlansHandler()).resolves.toMatchObject({ ok: false, code: "not_allowed" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("writes need billing.manage", () => {
  it("saves a new plan with snake-case keys and no id", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    const res = await savePlanHandler(input({ inclusions: ["  One ", ""] }));
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(res).toEqual({ ok: true, planId: ID });
    const [fn, args] = m.rpc.mock.calls[0] as [string, { p_actor: string; p_plan: object }];
    expect(fn).toBe("billing_save_plan");
    expect(args.p_actor).toBe(ME);
    expect(args.p_plan).toEqual({
      name: "Home",
      tagline: "",
      inclusions: ["One"],
      interval: "monthly",
      base_centavos: 49900,
      included_helpers: 1,
      included_managers: 2,
      included_homes: null,
      extra_helper_centavos: 9900,
      extra_manager_centavos: null,
      extra_home_centavos: null,
      trial_days: 0,
      is_public: true,
      sort_order: 0,
    });
  });

  it("sends the id when editing", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await savePlanHandler(input({ id: ID }));
    expect(m.rpc.mock.calls[0]?.[1]).toMatchObject({ p_plan: { id: ID } });
  });

  it("refuses a bad plan before any I/O", async () => {
    for (const bad of [
      input({ name: "  " }),
      input({ name: "x".repeat(61) }),
      input({ baseCentavos: -1 }),
      input({ baseCentavos: 19.5 }),
      input({ includedHelpers: -2 }),
      input({ trialDays: 4000 }),
      input({ interval: "weekly" as never }),
      input({ inclusions: Array.from({ length: 21 }, (_, i) => `L${i}`) }),
      input({ id: "nope" }),
    ]) {
      await expect(savePlanHandler(bad)).resolves.toMatchObject({ ok: false });
    }
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(() => parsePlanInput(input({ name: "" }))).toThrow("Give the plan a name");
  });

  it("changes a status", async () => {
    await expect(setPlanStatusHandler({ planId: ID, status: "active" })).resolves.toEqual({
      ok: true,
    });
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(m.rpc).toHaveBeenCalledWith("billing_set_plan_status", {
      p_actor: ME,
      p_plan_id: ID,
      p_status: "active",
    });
  });

  it("refuses a bad plan id or status before any I/O", async () => {
    await expect(setPlanStatusHandler({ planId: "x", status: "active" })).resolves.toMatchObject({
      code: "not_found",
    });
    await expect(
      setPlanStatusHandler({ planId: ID, status: "gone" as never }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("saves the free tier", async () => {
    await expect(
      saveBillingSettingsHandler({
        freeTierEnabled: false,
        freeHelperSeats: null,
        freeManagerSeats: 1,
        supportEmail: " help@x.com ",
      }),
    ).resolves.toEqual({ ok: true });
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(m.rpc).toHaveBeenCalledWith("billing_save_settings", {
      p_actor: ME,
      p_settings: {
        free_tier_enabled: false,
        free_helper_seats: null,
        free_manager_seats: 1,
        support_email: "help@x.com",
      },
    });
  });

  it("refuses a bad support email or seat count", async () => {
    const base = {
      freeTierEnabled: true,
      freeHelperSeats: 1,
      freeManagerSeats: 1,
      supportEmail: null,
    };
    await expect(
      saveBillingSettingsHandler({ ...base, supportEmail: "not an email" }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    await expect(
      saveBillingSettingsHandler({ ...base, freeHelperSeats: -1 }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("database errors", () => {
  it("a refusal (P0001) is a conflict with its plain sentence", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "A draft plan can't be moved to draft." },
    });
    await expect(setPlanStatusHandler({ planId: ID, status: "draft" })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "A draft plan can't be moved to draft.",
    });
  });

  it("an unapplied function is outside_service", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { message: "function public.billing_list_plans(uuid) does not exist" },
    });
    await expect(listPlansHandler()).resolves.toEqual({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
  });

  it("anything else says nothing about itself", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    await expect(listPlansHandler()).resolves.toMatchObject({
      ok: false,
      code: "outside_service",
    });
  });
});
