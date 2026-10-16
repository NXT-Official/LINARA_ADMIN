import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  freshCode: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
  invite: vi.fn(),
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
vi.mock("@/lib/server-env.server", () => ({
  serverEnv: () => ({ siteUrl: "http://localhost:8081" }),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    rpc: m.rpc,
    auth: { admin: { inviteUserByEmail: m.invite } },
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import {
  addAdminHandler,
  listAdminsHandler,
  listTeamNamesHandler,
  removeAdminHandler,
} from "./team.handlers.server";

const ME = { userId: "me", email: "me@console.example.com", preset: "admin" };
const ROLE = "7f0c2a7e-1b2c-4d5e-8f90-0000000000a1";
const B = "7f0c2a7e-1b2c-4d5e-8f90-0000000000b2";

/** rpc answers by function name; anything else resolves empty. */
function rpcAnswers(answers: Record<string, unknown>) {
  m.rpc.mockImplementation(async (fn: string) => answers[fn] ?? { data: null, error: null });
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.requireStaff.mockResolvedValue(ME);
  m.freshCode.mockResolvedValue(undefined);
  m.rate.mockResolvedValue(undefined);
  rpcAnswers({ staff_lookup_user: { data: [], error: null } });
});

describe("addAdminHandler (FR-TM-2, D39)", () => {
  it("invites a new email and adds them with the chosen role", async () => {
    m.invite.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
    await expect(
      addAdminHandler({ email: "New@Console.example.com ", roleId: ROLE }),
    ).resolves.toEqual({ ok: true });
    expect(m.requireStaff).toHaveBeenCalledWith("team.manage");
    expect(m.invite).toHaveBeenCalledWith("new@console.example.com", {
      redirectTo: "http://localhost:8081/accept-invite",
    });
    expect(m.rpc).toHaveBeenCalledWith("staff_add_member", {
      p_actor: "me",
      p_user_id: "new",
      p_role_id: ROLE,
      p_code_checked: false,
    });
    expect(m.freshCode).not.toHaveBeenCalled();
  });

  it("a code is verified before the call when given", async () => {
    m.invite.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
    await addAdminHandler({ email: "new@x.com", roleId: ROLE, code: "123456" });
    expect(m.freshCode).toHaveBeenCalledWith(ME, "123456");
    expect(m.rpc).toHaveBeenCalledWith(
      "staff_add_member",
      expect.objectContaining({ p_code_checked: true }),
    );
  });

  it("household emails can't join the team", async () => {
    rpcAnswers({
      staff_lookup_user: { data: [{ user_id: "h", has_household_profile: true }], error: null },
    });
    await expect(addAdminHandler({ email: "parent@x.com", roleId: ROLE })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That email has a Linara household account. Use an email only for the console.",
    });
    expect(m.invite).not.toHaveBeenCalled();
  });

  it("an existing account isn't invited again, and SQL's refusal is shown", async () => {
    rpcAnswers({
      staff_lookup_user: { data: [{ user_id: "b", has_household_profile: false }], error: null },
      staff_add_member: {
        data: null,
        error: { code: "P0001", message: "That email is already on the team." },
      },
    });
    await expect(addAdminHandler({ email: "b@x.com", roleId: ROLE })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That email is already on the team.",
    });
    expect(m.invite).not.toHaveBeenCalled();
  });

  it("a role deleted while adding someone gets a plain message", async () => {
    m.invite.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
    rpcAnswers({
      staff_lookup_user: { data: [], error: null },
      staff_add_member: { data: null, error: { code: "23503", message: "fk detail" } },
    });
    await expect(addAdminHandler({ email: "new@x.com", roleId: ROLE })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That role doesn't exist.",
    });
  });

  it("a role must be picked", async () => {
    await expect(addAdminHandler({ email: "new@x.com", roleId: "x" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "Pick a role.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a wrong code stops the action", async () => {
    m.freshCode.mockRejectedValue(new ConsoleError("invalid_input", "That code didn't work."));
    await expect(
      addAdminHandler({ email: "new@x.com", roleId: ROLE, code: "123456" }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.invite).not.toHaveBeenCalled();
  });

  it("adding members is rate limited before the code is checked", async () => {
    m.rate.mockRejectedValue(
      new ConsoleError("conflict", "Too many tries. Wait 60 minutes, then try again."),
    );
    await expect(
      addAdminHandler({ email: "new@x.com", roleId: ROLE, code: "123456" }),
    ).resolves.toMatchObject({
      ok: false,
      message: "Too many tries. Wait 60 minutes, then try again.",
    });
    expect(m.freshCode).not.toHaveBeenCalled();
  });
});

describe("removeAdminHandler (FR-TM-3, D39)", () => {
  it("can't remove yourself", async () => {
    await expect(removeAdminHandler({ userId: "me", code: "123456" })).resolves.toMatchObject({
      ok: false,
      message: "You can't remove yourself.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("SQL's refusal is shown and nothing else happens", async () => {
    rpcAnswers({
      staff_remove_member: {
        data: null,
        error: { code: "P0001", message: "There has to be at least one admin." },
      },
    });
    await expect(removeAdminHandler({ userId: B, code: "123456" })).resolves.toMatchObject({
      ok: false,
      message: "There has to be at least one admin.",
    });
    expect(m.rpc).not.toHaveBeenCalledWith("staff_end_sessions", expect.anything());
  });

  it("removal checks the code, then ends sessions", async () => {
    await expect(removeAdminHandler({ userId: B, code: "123456" })).resolves.toEqual({
      ok: true,
    });
    expect(m.freshCode).toHaveBeenCalledWith(ME, "123456");
    expect(m.rpc).toHaveBeenCalledWith("staff_remove_member", { p_actor: "me", p_user_id: B });
    expect(m.rpc).toHaveBeenLastCalledWith("staff_end_sessions", { p_user_id: B });
  });

  it("other errors say nothing", async () => {
    rpcAnswers({
      staff_remove_member: { data: null, error: { code: "XX000", message: "secret detail" } },
    });
    const res = await removeAdminHandler({ userId: B, code: "123456" });
    expect(JSON.stringify(res)).not.toContain("secret detail");
  });
});

describe("listAdminsHandler (FR-TM-1)", () => {
  it("listing members is one call and carries each role", async () => {
    rpcAnswers({
      staff_list_admins: {
        data: [
          {
            user_id: "me",
            email: "me@console.example.com",
            granted_at: "2026-10-01T00:00:00Z",
            last_sign_in_at: null,
            two_step_set_up: true,
            role_id: ROLE,
            role_name: "Admin",
            preset: "admin",
          },
        ],
        error: null,
      },
    });
    await expect(listAdminsHandler()).resolves.toEqual({
      ok: true,
      admins: [
        {
          userId: "me",
          email: "me@console.example.com",
          addedAt: "2026-10-01T00:00:00Z",
          lastSignInAt: null,
          twoStepSetUp: true,
          isYou: true,
          roleId: ROLE,
          roleName: "Admin",
          preset: "admin",
        },
      ],
    });
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("listTeamNamesHandler (owner and assignee names)", () => {
  it("team names need only the dashboard, which every role has, and carry no roles or sign-in data", async () => {
    rpcAnswers({
      staff_list_admins: {
        data: [
          {
            user_id: "me",
            email: "me@console.example.com",
            granted_at: "2026-10-01T00:00:00Z",
            last_sign_in_at: "2026-10-15T00:00:00Z",
            two_step_set_up: true,
            role_id: ROLE,
            role_name: "Support",
            preset: "support",
          },
        ],
        error: null,
      },
    });
    await expect(listTeamNamesHandler()).resolves.toEqual({
      ok: true,
      members: [{ userId: "me", email: "me@console.example.com", isYou: true }],
    });
    expect(m.requireStaff).toHaveBeenCalledWith("dashboard.view");
  });
});
