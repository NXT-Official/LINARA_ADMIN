import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  order: [] as string[],
  requireStaff: vi.fn(),
  code: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => {
    m.order.push("guard");
    return m.requireStaff(...a);
  },
}));
vi.mock("@/features/auth/reauth.server", () => ({
  requireFreshCode: (...a: unknown[]) => {
    m.order.push("code");
    return m.code(...a);
  },
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    rpc: (...a: unknown[]) => {
      m.order.push(`rpc:${a[0]}`);
      return m.rpc(...a);
    },
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import {
  getHouseholdBillingHandler,
  grantPlanHandler,
  markInvoicePaidHandler,
  revokeSubscriptionHandler,
} from "./billing.handlers.server";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const HOME = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const PLAN = "7f0c2a7e-1b2c-4d5e-8f90-0000000000a1";
const INVOICE = "7f0c2a7e-1b2c-4d5e-8f90-0000000000b1";

const grant = {
  householdId: HOME,
  planId: PLAN,
  helperSeats: null,
  managerSeats: 2,
  periodEnd: null,
  note: "",
  reason: "Pilot household",
  code: "123456",
};
const paid = {
  invoiceId: INVOICE,
  channel: "gcash" as const,
  note: "Ref 1234",
  reason: "Paid by GCash",
  code: "123456",
};

const DETAIL = {
  entitlements: {
    source: "subscription",
    subscription_id: "s1",
    plan_name: "Family",
    status: "active",
    effective_status: "active",
    helper_seats: 3,
    manager_seats: null,
    period_end: "2026-12-01T00:00:00Z",
    days_left: 40,
  },
  subscriptions: [
    {
      id: "s1",
      plan_name: "Family",
      interval: "monthly",
      status: "active",
      helper_seats: 3,
      manager_seats: null,
      home_seats: 1,
      amount_centavos: "49900",
      current_period_start: "2026-11-01T00:00:00Z",
      current_period_end: "2026-12-01T00:00:00Z",
      canceled_at: null,
      note: "Refund this",
      created_at: "2026-11-01T00:00:00Z",
      revoked: false,
    },
    {
      id: "s0",
      plan_name: "Pilot",
      interval: "monthly",
      status: "canceled",
      helper_seats: 2,
      manager_seats: 2,
      home_seats: 1,
      amount_centavos: 0,
      current_period_start: "2026-10-01T00:00:00Z",
      current_period_end: "2026-10-10T00:00:00Z",
      canceled_at: "2026-10-10T00:00:00Z",
      note: "Revoked by staff: Pilot ended",
      created_at: "2026-10-01T00:00:00Z",
      revoked: true,
    },
  ],
  invoices: [
    {
      id: INVOICE,
      invoice_number: "LIN-2026-000001",
      subscription_id: "s1",
      status: "pending",
      amount_centavos: 49900,
      currency: "PHP",
      period_start: "2026-11-01T00:00:00Z",
      period_end: null,
      paid_at: null,
      paid_channel: null,
      created_at: "2026-11-01T00:00:00Z",
    },
  ],
  homes: [{ id: HOME, name: "Santos" }],
  usage: { helpers: 2, managers: 1 },
  notes: [{ subscription_id: "s1", status: "active", note: "Refund this" }],
};

beforeEach(() => {
  m.order = [];
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.code.mockReset().mockResolvedValue(undefined);
  m.rpc.mockReset().mockResolvedValue({ data: DETAIL, error: null });
});

describe("getHouseholdBillingHandler", () => {
  it("validates, checks billing.view, then reads and maps to camelCase", async () => {
    const res = await getHouseholdBillingHandler({ householdId: HOME });
    expect(m.order).toEqual(["guard", "rpc:billing_household_detail"]);
    expect(m.requireStaff).toHaveBeenCalledWith("billing.view");
    expect(m.rpc).toHaveBeenCalledWith("billing_household_detail", {
      p_actor: ME,
      p_household_id: HOME,
      p_now: expect.any(String),
    });
    expect(res).toMatchObject({
      ok: true,
      billing: {
        entitlements: { planName: "Family", helperSeats: 3, managerSeats: null },
        subscriptions: [
          { planName: "Family", amountCentavos: 49900, revoked: false },
          { planName: "Pilot", revoked: true },
        ],
        invoices: [{ invoiceNumber: "LIN-2026-000001", amountCentavos: 49900 }],
        usage: { helpers: 2, managers: 1 },
        notes: [{ note: "Refund this" }],
      },
    });
  });

  it("a malformed id is not found before anything else", async () => {
    await expect(getHouseholdBillingHandler({ householdId: "x" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
  });

  it("refuses a role without billing.view", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(getHouseholdBillingHandler({ householdId: HOME })).resolves.toMatchObject({
      code: "not_allowed",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a missing function is on our side", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function public.billing_household_detail does not exist" },
    });
    await expect(getHouseholdBillingHandler({ householdId: HOME })).resolves.toMatchObject({
      code: "outside_service",
    });
  });

  it("P0001 is a conflict with the plain sentence", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That household doesn't exist." },
    });
    await expect(getHouseholdBillingHandler({ householdId: HOME })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That household doesn't exist.",
    });
  });
});

describe("grantPlanHandler", () => {
  beforeEach(() => {
    m.rpc.mockResolvedValue({ data: { subscription_id: "s9", invoice_id: "i9" }, error: null });
  });

  it("checks billing.manage and the code before the call; nulls pass through", async () => {
    await expect(grantPlanHandler(grant)).resolves.toEqual({
      ok: true,
      subscriptionId: "s9",
      invoiceId: "i9",
    });
    expect(m.order).toEqual(["guard", "code", "rpc:billing_grant"]);
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(m.code).toHaveBeenCalledWith({ userId: ME }, "123456");
    expect(m.rpc).toHaveBeenCalledWith("billing_grant", {
      p_actor: ME,
      p_household_id: HOME,
      p_plan_id: PLAN,
      p_helper_seats: null,
      p_manager_seats: 2,
      p_period_end: null,
      p_note: null,
      p_reason: "Pilot household",
    });
  });

  it("an end date runs to 11:59 pm Manila time", async () => {
    await grantPlanHandler({ ...grant, periodEnd: "2027-01-31", note: "Comp" });
    expect(m.rpc).toHaveBeenCalledWith(
      "billing_grant",
      expect.objectContaining({ p_period_end: "2027-01-31T23:59:00+08:00", p_note: "Comp" }),
    );
  });

  it("1000 seats is the most a grant gives", async () => {
    await grantPlanHandler({ ...grant, helperSeats: 1000, managerSeats: 0 });
    expect(m.rpc).toHaveBeenCalledWith(
      "billing_grant",
      expect.objectContaining({ p_helper_seats: 1000, p_manager_seats: 0 }),
    );
  });

  it.each([
    ["negative seats", { helperSeats: -1 }],
    ["fractional seats", { managerSeats: 1.5 }],
    ["over 1000 helper seats", { helperSeats: 1001 }],
    ["over 1000 manager seats", { managerSeats: 1001 }],
    ["an impossible date", { periodEnd: "2027-02-30" }],
    ["a long note", { note: "x".repeat(501) }],
    ["no reason", { reason: "  " }],
    ["a long reason", { reason: "x".repeat(201) }],
  ])("rejects %s before any I/O", async (_name, over) => {
    await expect(grantPlanHandler({ ...grant, ...over })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
  });

  it("a wrong code stops it before the database", async () => {
    m.code.mockRejectedValue(new ConsoleError("invalid_input", "That code didn't work."));
    await expect(grantPlanHandler(grant)).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a refusal from the database is a conflict", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "The end date must be in the future." },
    });
    await expect(grantPlanHandler(grant)).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "The end date must be in the future.",
    });
  });
});

describe("revokeSubscriptionHandler", () => {
  const SUB = "7f0c2a7e-1b2c-4d5e-8f90-0000000000c1";
  const revoke = { subscriptionId: SUB, reason: "Chargeback", code: "123456" };

  beforeEach(() => {
    m.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("checks billing.manage and the code, then revokes with the reason", async () => {
    await expect(revokeSubscriptionHandler(revoke)).resolves.toEqual({ ok: true });
    expect(m.order).toEqual(["guard", "code", "rpc:billing_revoke"]);
    expect(m.requireStaff).toHaveBeenCalledWith("billing.manage");
    expect(m.code).toHaveBeenCalledWith({ userId: ME }, "123456");
    expect(m.rpc).toHaveBeenCalledWith("billing_revoke", {
      p_actor: ME,
      p_subscription_id: SUB,
      p_reason: "Chargeback",
    });
  });

  it("rejects a bad id and a missing or long reason before any I/O", async () => {
    await expect(
      revokeSubscriptionHandler({ ...revoke, subscriptionId: "x" }),
    ).resolves.toMatchObject({ code: "not_found" });
    await expect(revokeSubscriptionHandler({ ...revoke, reason: "  " })).resolves.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      revokeSubscriptionHandler({ ...revoke, reason: "x".repeat(201) }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.requireStaff).not.toHaveBeenCalled();
  });

  it("a role without billing.manage or a wrong code never reaches the database", async () => {
    m.requireStaff.mockRejectedValueOnce(new ConsoleError("not_allowed"));
    await expect(revokeSubscriptionHandler(revoke)).resolves.toMatchObject({
      code: "not_allowed",
    });
    m.code.mockRejectedValueOnce(new ConsoleError("invalid_input", "That code didn't work."));
    await expect(revokeSubscriptionHandler(revoke)).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("an already revoked plan is a conflict with the plain sentence", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That subscription is already revoked." },
    });
    await expect(revokeSubscriptionHandler(revoke)).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That subscription is already revoked.",
    });
  });
});

describe("markInvoicePaidHandler", () => {
  it("checks billing.manage and the code, then marks paid", async () => {
    m.rpc.mockResolvedValue({
      data: { applied: true, invoice_status: "paid", subscription_status: "active" },
      error: null,
    });
    await expect(markInvoicePaidHandler(paid)).resolves.toEqual({ ok: true, applied: true });
    expect(m.order).toEqual(["guard", "code", "rpc:billing_mark_paid"]);
    expect(m.rpc).toHaveBeenCalledWith("billing_mark_paid", {
      p_actor: ME,
      p_invoice_id: INVOICE,
      p_channel: "gcash",
      p_note: "Ref 1234",
      p_reason: "Paid by GCash",
    });
  });

  it("applied false is surfaced as ok, not as a payment", async () => {
    m.rpc.mockResolvedValue({
      data: { applied: false, invoice_status: "paid", subscription_status: "active" },
      error: null,
    });
    await expect(markInvoicePaidHandler(paid)).resolves.toEqual({ ok: true, applied: false });
  });

  it("rejects an unknown channel and a bad id before any I/O", async () => {
    await expect(
      markInvoicePaidHandler({ ...paid, channel: "crypto" as never }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    await expect(markInvoicePaidHandler({ ...paid, invoiceId: "x" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
  });
});
