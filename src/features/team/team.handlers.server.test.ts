import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  freshCode: vi.fn(),
  rate: vi.fn(),
  audit: vi.fn(),
  rpc: vi.fn(),
  invite: vi.fn(),
  getUserById: vi.fn(),
  listFactors: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  roles: [] as { user_id: string }[],
  existingRole: null as { role: string } | null,
}));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/features/auth/reauth.server", () => ({
  requireFreshCode: (...a: unknown[]) => m.freshCode(...a),
}));
vi.mock("@/features/auth/rate-limit.server", () => ({
  checkRateLimit: (...a: unknown[]) => m.rate(...a),
}));
vi.mock("@/features/audit/audit.server", () => ({
  writeAudit: (...a: unknown[]) => m.audit(...a),
}));
vi.mock("@/lib/server-env.server", () => ({
  serverEnv: () => ({ siteUrl: "http://localhost:8081" }),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    rpc: m.rpc,
    auth: {
      admin: {
        inviteUserByEmail: m.invite,
        getUserById: m.getUserById,
        mfa: { listFactors: m.listFactors },
      },
    },
    from: () => ({
      insert: m.insert,
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: m.existingRole, error: null }) }),
        then: (resolve: (v: unknown) => void) => resolve({ data: m.roles, error: null }),
      }),
      delete: () => ({ eq: (...a: unknown[]) => m.del(...a) }),
    }),
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import { addAdminHandler, listAdminsHandler, removeAdminHandler } from "./team.handlers.server";

const ME = {
  userId: "me",
  email: "me@console.example.com",
  role: "admin",
  sessionId: "s",
  aal: "aal2",
};

beforeEach(() => {
  for (const f of Object.values(m)) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  m.requireStaff.mockResolvedValue(ME);
  m.freshCode.mockResolvedValue(undefined);
  m.rate.mockResolvedValue(undefined);
  m.audit.mockResolvedValue(undefined);
  m.insert.mockResolvedValue({ error: null });
  m.del.mockResolvedValue({ error: null });
  m.roles = [{ user_id: "me" }, { user_id: "b" }];
  m.existingRole = null;
});

describe("addAdminHandler (FR-TM-2)", () => {
  it("invites a new email and grants the role", async () => {
    m.rpc.mockResolvedValue({ data: [], error: null });
    m.invite.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
    await expect(
      addAdminHandler({ email: "new@console.example.com", code: "123456" }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(m.invite).toHaveBeenCalledWith("new@console.example.com", {
      redirectTo: "http://localhost:8081/accept-invite",
    });
    expect(m.insert).toHaveBeenCalledWith({ user_id: "new", role: "admin", granted_by: "me" });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff.added", targetType: "staff", targetId: "new" }),
    );
  });

  it("household emails can't become admins", async () => {
    m.rpc.mockResolvedValue({ data: [{ user_id: "h", has_household_profile: true }], error: null });
    await expect(addAdminHandler({ email: "parent@x.com", code: "123456" })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That email has a Linara household account. Use an email only for the console.",
    });
    expect(m.invite).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("an existing admin isn't added twice", async () => {
    m.rpc.mockResolvedValue({
      data: [{ user_id: "b", has_household_profile: false }],
      error: null,
    });
    m.existingRole = { role: "admin" };
    await expect(addAdminHandler({ email: "b@x.com", code: "123456" })).resolves.toMatchObject({
      ok: false,
      message: "That email is already an admin.",
    });
  });

  it("a wrong code stops the action", async () => {
    m.freshCode.mockRejectedValue(new ConsoleError("invalid_input", "That code didn't work."));
    await expect(addAdminHandler({ email: "new@x.com", code: "123456" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.invite).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("adding admins is rate limited before the code is checked", async () => {
    m.rate.mockRejectedValue(
      new ConsoleError("conflict", "Too many tries. Wait 60 minutes, then try again."),
    );
    await expect(addAdminHandler({ email: "new@x.com", code: "123456" })).resolves.toMatchObject({
      ok: false,
      message: "Too many tries. Wait 60 minutes, then try again.",
    });
    expect(m.freshCode).not.toHaveBeenCalled();
  });
});

describe("removeAdminHandler (FR-TM-3)", () => {
  it("can't remove yourself", async () => {
    await expect(removeAdminHandler({ userId: "me", code: "123456" })).resolves.toMatchObject({
      ok: false,
      message: "You can't remove yourself.",
    });
    expect(m.del).not.toHaveBeenCalled();
  });

  it("can't remove the last admin", async () => {
    m.roles = [{ user_id: "b" }];
    await expect(removeAdminHandler({ userId: "b", code: "123456" })).resolves.toMatchObject({
      ok: false,
      message: "There has to be at least one admin.",
    });
    expect(m.del).not.toHaveBeenCalled();
  });

  it("removal ends sessions", async () => {
    m.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(removeAdminHandler({ userId: "b", code: "123456" })).resolves.toEqual({
      ok: true,
    });
    expect(m.del).toHaveBeenCalledWith("user_id", "b");
    expect(m.rpc).toHaveBeenCalledWith("staff_end_sessions", { p_user_id: "b" });
    const entry = m.audit.mock.calls[0][0];
    expect(entry).toMatchObject({ action: "staff.removed", targetType: "staff", targetId: "b" });
    expect(JSON.stringify(entry)).not.toContain("@");
  });
});

describe("listAdminsHandler", () => {
  it("listing admins is one call", async () => {
    m.rpc.mockResolvedValue({
      data: [
        {
          user_id: "me",
          email: "me@console.example.com",
          granted_at: "2026-10-01T00:00:00Z",
          last_sign_in_at: null,
          two_step_set_up: true,
        },
      ],
      error: null,
    });
    const res = await listAdminsHandler();
    expect(res).toEqual({
      ok: true,
      admins: [
        {
          userId: "me",
          email: "me@console.example.com",
          addedAt: "2026-10-01T00:00:00Z",
          lastSignInAt: null,
          twoStepSetUp: true,
          isYou: true,
        },
      ],
    });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("staff_list_admins");
    expect(m.getUserById).not.toHaveBeenCalled();
    expect(m.listFactors).not.toHaveBeenCalled();
  });
});
