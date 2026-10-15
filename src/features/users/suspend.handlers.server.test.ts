import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  order: [] as string[],
  requireStaff: vi.fn(),
  code: vi.fn(),
  audit: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
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
vi.mock("@/features/audit/audit.server", () => ({
  writeAudit: (...a: unknown[]) => {
    m.order.push("audit");
    return m.audit(...a);
  },
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    rpc: (...a: unknown[]) => {
      m.order.push(`rpc:${a[0]}`);
      return m.rpc(...a);
    },
    auth: {
      admin: {
        updateUserById: (...a: unknown[]) => {
          m.order.push("auth");
          return m.update(...a);
        },
      },
    },
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import { setSuspendedHandler } from "./suspend.handlers.server";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const USER = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const input = {
  userId: USER,
  suspended: true,
  reason: "Reported for harassing a helper",
  code: "123456",
};

beforeEach(() => {
  m.order = [];
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.code.mockReset().mockResolvedValue(undefined);
  m.audit.mockReset().mockResolvedValue(undefined);
  m.rpc.mockReset().mockResolvedValue({ data: false, error: null });
  m.update.mockReset().mockResolvedValue({ data: { user: { id: USER } }, error: null });
});

describe("setSuspendedHandler (FR-US-4, FR-US-5, S-5, D36)", () => {
  it("checks users.suspend first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(setSuspendedHandler(input)).resolves.toMatchObject({ code: "not_allowed" });
    expect(m.requireStaff).toHaveBeenCalledWith("users.suspend");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("a reason is required", async () => {
    await expect(setSuspendedHandler({ ...input, reason: " no " })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.code).not.toHaveBeenCalled();
  });

  it("console admins can't be suspended", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    await expect(setSuspendedHandler(input)).resolves.toEqual({
      ok: false,
      code: "not_allowed",
      message: "Console admins are managed on the Admins screen.",
    });
    expect(m.rpc).toHaveBeenCalledWith("staff_is_console_admin", { p_user_id: USER });
    expect(m.code).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("the code is checked before Auth is called", async () => {
    m.code.mockRejectedValue(new ConsoleError("invalid_input", "That code didn't work."));
    await expect(setSuspendedHandler(input)).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("suspend bans until unbanned and records the reason", async () => {
    await expect(setSuspendedHandler(input)).resolves.toEqual({ ok: true });
    expect(m.order).toEqual(["guard", "rpc:staff_is_console_admin", "code", "auth", "audit"]);
    expect(m.update).toHaveBeenCalledWith(USER, { ban_duration: "876000h" });
    expect(m.audit).toHaveBeenCalledWith({
      actorId: ME,
      action: "user.suspended",
      targetType: "user",
      targetId: USER,
      reason: "Reported for harassing a helper",
    });
  });

  it("unsuspend lifts the ban", async () => {
    await setSuspendedHandler({ ...input, suspended: false, reason: "Cleared after review" });
    expect(m.update).toHaveBeenCalledWith(USER, { ban_duration: "none" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.unsuspended" }));
  });

  it("an unknown account is not found, and other Auth errors say nothing", async () => {
    m.update.mockResolvedValue({ data: null, error: { status: 404, message: "User not found" } });
    await expect(setSuspendedHandler(input)).resolves.toMatchObject({ code: "not_found" });
    m.update.mockResolvedValue({ data: null, error: { status: 500, message: "db down" } });
    await expect(setSuspendedHandler(input)).resolves.toEqual({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("a malformed id is not found before anything else", async () => {
    await expect(setSuspendedHandler({ ...input, userId: "x" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
  });
});
