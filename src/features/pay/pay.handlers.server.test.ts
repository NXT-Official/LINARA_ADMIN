import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  audit: vi.fn(),
  tables: [] as string[],
  profile: null as { user_id: string | null; monthly_rate: number | null } | null,
  account: null as { method: string; account_name: string; account_number: string } | null,
  attempt: null as { amount_sent: number | string; payslips: { helper_id: string } | null } | null,
}));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/features/audit/audit.server", () => ({
  writeAudit: (...a: unknown[]) => m.audit(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      m.tables.push(table);
      const result =
        table === "helper_profiles"
          ? m.profile
          : table === "payout_attempts"
            ? m.attempt
            : m.account;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: result, error: null }),
      };
      return chain;
    },
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import { revealPayHandler, revealPayoutAmountHandler } from "./pay.handlers.server";

const HELPER = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const RATE = 18000;
const ACCOUNT = "09998887777";

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.audit.mockReset().mockResolvedValue(undefined);
  m.tables = [];
  m.profile = { user_id: "u1", monthly_rate: RATE };
  m.account = { method: "PH_GCASH", account_name: "Carla D", account_number: ACCOUNT };
  m.attempt = { amount_sent: "4321.50", payslips: { helper_id: HELPER } };
});

describe("revealPayHandler (FR-US-6, S-17)", () => {
  it("reveal checks pay.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(revealPayHandler({ helperId: HELPER, field: "wage" })).resolves.toMatchObject({
      code: "not_allowed",
    });
    expect(m.requireStaff).toHaveBeenCalledWith("pay.view");
    expect(m.tables).toEqual([]);
  });

  it("a wage click returns the wage only", async () => {
    const res = await revealPayHandler({ helperId: HELPER, field: "wage" });
    expect(res).toEqual({ ok: true, pay: { field: "wage", monthlyRate: RATE } });
    expect(JSON.stringify(res)).not.toContain(ACCOUNT);
    expect(m.tables).toEqual(["helper_profiles"]);
  });

  it("an account click returns the payout account only", async () => {
    const res = await revealPayHandler({ helperId: HELPER, field: "account" });
    expect(res).toEqual({
      ok: true,
      pay: {
        field: "account",
        payoutAccount: { method: "PH_GCASH", accountName: "Carla D", accountNumber: ACCOUNT },
      },
    });
    expect(JSON.stringify(res)).not.toContain(String(RATE));
  });

  it("records the reveal without the amount", async () => {
    await revealPayHandler({ helperId: HELPER, field: "wage" });
    expect(m.audit).toHaveBeenCalledWith({
      actorId: "me",
      action: "pay.revealed",
      targetType: "helper",
      targetId: HELPER,
      metadata: { fields: "monthly_rate" },
    });
    await revealPayHandler({ helperId: HELPER, field: "account" });
    expect(m.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { fields: "payout_account" } }),
    );
    const logged = JSON.stringify(m.audit.mock.calls);
    expect(logged).not.toContain(String(RATE));
    expect(logged).not.toContain(ACCOUNT);
  });

  it("no value without an audit entry", async () => {
    m.audit.mockRejectedValue(new ConsoleError("outside_service"));
    const res = await revealPayHandler({ helperId: HELPER, field: "wage" });
    expect(res).toMatchObject({ ok: false, code: "outside_service" });
    expect(JSON.stringify(res)).not.toContain(String(RATE));
  });

  it("invited helper has no payout account", async () => {
    m.profile = { user_id: null, monthly_rate: 15000 };
    await expect(revealPayHandler({ helperId: HELPER, field: "account" })).resolves.toEqual({
      ok: true,
      pay: { field: "account", payoutAccount: null },
    });
    expect(m.tables).toEqual(["helper_profiles"]);
  });

  it("unknown helper is not_found and records nothing", async () => {
    m.profile = null;
    await expect(revealPayHandler({ helperId: HELPER, field: "wage" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("malformed helper id or field is refused before the guard", async () => {
    await expect(revealPayHandler({ helperId: "x", field: "wage" })).resolves.toMatchObject({
      code: "not_found",
    });
    await expect(
      revealPayHandler({ helperId: HELPER, field: "everything" as never }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.requireStaff).not.toHaveBeenCalled();
  });
});

describe("revealPayoutAmountHandler (FR-PO-1, S-17, D38)", () => {
  const ATTEMPT = "7f0c2a7e-1b2c-4d5e-8f90-0000000000aa";

  it("checks pay.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(revealPayoutAmountHandler({ attemptId: ATTEMPT })).resolves.toMatchObject({
      code: "not_allowed",
    });
    expect(m.requireStaff).toHaveBeenCalledWith("pay.view");
    expect(m.tables).toEqual([]);
  });

  it("returns the amount of that attempt, in one read", async () => {
    await expect(revealPayoutAmountHandler({ attemptId: ATTEMPT })).resolves.toEqual({
      ok: true,
      amount: 4321.5,
    });
    expect(m.tables).toEqual(["payout_attempts"]);
  });

  it("reveal audit holds ids only", async () => {
    await revealPayoutAmountHandler({ attemptId: ATTEMPT });
    expect(m.audit).toHaveBeenCalledWith({
      actorId: "me",
      action: "pay.revealed",
      targetType: "helper",
      targetId: HELPER,
      metadata: { fields: "payout_amount", attempt_id: ATTEMPT },
    });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("4321");
  });

  it("no amount without its audit row", async () => {
    m.audit.mockRejectedValue(new ConsoleError("outside_service"));
    const res = await revealPayoutAmountHandler({ attemptId: ATTEMPT });
    expect(res).toMatchObject({ ok: false, code: "outside_service" });
    expect(JSON.stringify(res)).not.toContain("4321");
  });

  it("an unknown attempt says not found and records nothing", async () => {
    m.attempt = null;
    await expect(revealPayoutAmountHandler({ attemptId: ATTEMPT })).resolves.toMatchObject({
      code: "not_found",
    });
    await expect(revealPayoutAmountHandler({ attemptId: "x" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.audit).not.toHaveBeenCalled();
  });
});
