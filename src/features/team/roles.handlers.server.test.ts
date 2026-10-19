import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  freshCode: vi.fn(),
  rpc: vi.fn(),
  rate: vi.fn(),
}));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/features/auth/reauth.server", () => ({
  requireFreshCode: (...a: unknown[]) => m.freshCode(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({ getAdminClient: () => ({ rpc: m.rpc }) }));
vi.mock("@/features/auth/rate-limit.server", () => ({
  checkRateLimit: (...a: unknown[]) => m.rate(...a),
}));

import { ConsoleError } from "@/lib/console-error";

import {
  createRoleHandler,
  deleteRoleHandler,
  listRolesHandler,
  setMemberRoleHandler,
  updateRoleHandler,
} from "./roles.handlers.server";
import { assignableRoles, canChangeMember, needsCode, type RoleRow } from "./roles.types";

const ME = { userId: "me", email: "mod@x.com", preset: "mods" };
const ROLE = "7f0c2a7e-1b2c-4d5e-8f90-0000000000a1";
const USER = "7f0c2a7e-1b2c-4d5e-8f90-0000000000b1";
const SEEN = "2026-10-16T01:02:03.456Z";

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.requireStaff.mockResolvedValue(ME);
  m.freshCode.mockResolvedValue(undefined);
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.rate.mockResolvedValue(undefined);
});

const calls = [
  () => listRolesHandler(),
  () => createRoleHandler({ name: "Leads", description: "", permissions: ["dashboard.view"] }),
  () =>
    updateRoleHandler({
      roleId: ROLE,
      name: "Leads",
      description: "",
      permissions: ["dashboard.view"],
      seenUpdatedAt: SEEN,
    }),
  () => deleteRoleHandler({ roleId: ROLE }),
  () => setMemberRoleHandler({ userId: USER, roleId: ROLE }),
];

describe("roles handlers (FR-RL-1 to FR-RL-6)", () => {
  it("each handler checks team.manage first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    for (const call of calls) {
      await expect(call()).resolves.toMatchObject({ ok: false, code: "not_allowed" });
    }
    expect(m.requireStaff).toHaveBeenCalledTimes(calls.length);
    for (const c of m.requireStaff.mock.calls) expect(c[0]).toBe("team.manage");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("the handler passes the actor, never trusts the picker", async () => {
    await setMemberRoleHandler({ userId: USER, roleId: ROLE });
    expect(m.rpc).toHaveBeenCalledWith("staff_set_member_role", {
      p_actor: "me",
      p_user_id: USER,
      p_role_id: ROLE,
      p_code_checked: false,
    });
  });

  it("a code is verified before the call when given", async () => {
    await updateRoleHandler({
      roleId: ROLE,
      name: "Leads",
      description: "Handles leads",
      permissions: ["crm.view", "dashboard.view"],
      seenUpdatedAt: SEEN,
      code: "123456",
    });
    expect(m.freshCode).toHaveBeenCalledWith(ME, "123456");
    expect(m.rpc).toHaveBeenCalledWith("staff_update_role", {
      p_actor: "me",
      p_role_id: ROLE,
      p_name: "Leads",
      p_description: "Handles leads",
      p_permissions: ["crm.view", "dashboard.view"],
      p_seen_updated_at: SEEN,
      p_code_checked: true,
    });
  });

  it("P0001 message shown, other errors say nothing", async () => {
    m.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "Mods can't give the admin or mods role." },
    });
    await expect(setMemberRoleHandler({ userId: USER, roleId: ROLE })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "Mods can't give the admin or mods role.",
    });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret" } });
    const res = await deleteRoleHandler({ roleId: ROLE });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("name and description are trimmed and limited before the call", async () => {
    m.rpc.mockResolvedValue({ data: ROLE, error: null });
    await expect(
      createRoleHandler({
        name: "  Lead desk ",
        description: "  ",
        permissions: ["dashboard.view", "crm.view", "crm.view"],
        code: "123456",
      }),
    ).resolves.toEqual({ ok: true, roleId: ROLE });
    expect(m.freshCode).toHaveBeenCalledWith(ME, "123456");
    expect(m.rpc).toHaveBeenCalledWith("staff_create_role", {
      p_actor: "me",
      p_name: "Lead desk",
      p_description: null,
      p_permissions: ["crm.view", "dashboard.view"],
      p_code_checked: true,
    });
    m.rpc.mockClear();
    for (const bad of [
      { name: "", description: "", permissions: ["dashboard.view"] },
      { name: "x".repeat(41), description: "", permissions: ["dashboard.view"] },
      { name: "Ok", description: "x".repeat(201), permissions: ["dashboard.view"] },
      { name: "Ok", description: "", permissions: ["dashboard.view", "crm.delete"] },
    ]) {
      await expect(createRoleHandler(bad as never)).resolves.toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("role and member-role changes are rate limited before the code (D30)", async () => {
    m.rate.mockRejectedValue(
      new ConsoleError("conflict", "Too many tries. Wait 60 minutes, then try again."),
    );
    for (const call of calls.slice(1)) {
      await expect(call()).resolves.toMatchObject({
        ok: false,
        message: "Too many tries. Wait 60 minutes, then try again.",
      });
    }
    expect(m.rate).toHaveBeenCalledWith("team_change", { adminId: "me" });
    expect(m.freshCode).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    m.rate.mockClear();
    await listRolesHandler();
    expect(m.rate).not.toHaveBeenCalled();
  });

  it("a role deleted or a name taken at the same moment gets a plain message", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "23503", message: "fk detail" } });
    await expect(setMemberRoleHandler({ userId: USER, roleId: ROLE })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That role doesn't exist.",
    });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "dup detail" } });
    await expect(
      createRoleHandler({ name: "Leads", description: "", permissions: ["dashboard.view"] }),
    ).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "A role with that name already exists.",
    });
  });

  it("lists roles", async () => {
    m.rpc.mockResolvedValue({
      data: [
        {
          role_id: ROLE,
          preset: null,
          name: "Leads",
          description: null,
          permissions: ["dashboard.view"],
          member_count: 2,
          updated_at: SEEN,
        },
      ],
      error: null,
    });
    await expect(listRolesHandler()).resolves.toEqual({
      ok: true,
      roles: [
        {
          roleId: ROLE,
          preset: null,
          name: "Leads",
          description: null,
          permissions: ["dashboard.view"],
          memberCount: 2,
          updatedAt: SEEN,
        },
      ],
    });
  });
});

const role = (preset: RoleRow["preset"], name = preset ?? "Custom"): RoleRow => ({
  roleId: name,
  preset,
  name,
  description: null,
  permissions: ["dashboard.view"],
  memberCount: 0,
  updatedAt: SEEN,
});
const ROLES = [role("admin"), role("mods"), role("sales"), role("support"), role(null, "Leads")];

describe("D39 rules in the browser", () => {
  it("assignableRoles for admin and mods", () => {
    expect(assignableRoles("admin", ROLES).map((r) => r.name)).toEqual([
      "mods",
      "sales",
      "support",
      "Leads",
    ]);
    expect(assignableRoles("mods", ROLES).map((r) => r.name)).toEqual([
      "sales",
      "support",
      "Leads",
    ]);
    expect(assignableRoles("sales", ROLES)).toEqual([]);
    expect(assignableRoles(null, ROLES)).toEqual([]);
  });

  it("canChangeMember covers self, admin, mods, sales and custom", () => {
    const admin = { userId: "a", preset: "admin" as const };
    const mod = { userId: "m", preset: "mods" as const };
    expect(canChangeMember(admin, admin)).toEqual({ ok: false, why: "This is you." });
    expect(canChangeMember(admin, { userId: "x", preset: "admin" })).toEqual({ ok: true });
    expect(canChangeMember(admin, { userId: "x", preset: "mods" })).toEqual({ ok: true });
    expect(canChangeMember(mod, { userId: "x", preset: "admin" })).toEqual({
      ok: false,
      why: "Only admins can change admins and mods.",
    });
    expect(canChangeMember(mod, { userId: "x", preset: "mods" })).toMatchObject({ ok: false });
    expect(canChangeMember(mod, { userId: "x", preset: "sales" })).toEqual({ ok: true });
    expect(canChangeMember(mod, { userId: "x", preset: null })).toEqual({ ok: true });
  });

  it("super admin is never given, changed or removed from the console (D43)", () => {
    const withSuper = [role("super_admin", "Super admin"), ...ROLES];
    const superAdmin = { userId: "s", preset: "super_admin" as const };
    const admin = { userId: "a", preset: "admin" as const };
    expect(assignableRoles("super_admin", withSuper).map((r) => r.name)).toEqual([
      "admin",
      "mods",
      "sales",
      "support",
      "Leads",
    ]);
    expect(assignableRoles("admin", withSuper).map((r) => r.preset)).not.toContain("super_admin");
    // Only the super admin gives admin (D44).
    expect(assignableRoles("admin", withSuper).map((r) => r.preset)).not.toContain("admin");
    expect(canChangeMember(admin, { userId: "s", preset: "super_admin" })).toEqual({
      ok: false,
      why: "The super admin can't be changed or removed.",
    });
    expect(canChangeMember(superAdmin, superAdmin)).toEqual({ ok: false, why: "This is you." });
    expect(canChangeMember(superAdmin, { userId: "x", preset: "admin" })).toEqual({ ok: true });
    expect(canChangeMember(superAdmin, { userId: "x", preset: "mods" })).toEqual({ ok: true });
  });

  it("needsCode for any new access but sales and support (spec 0.19)", () => {
    expect(needsCode(role("admin"))).toBe(true);
    expect(needsCode(role("mods"))).toBe(true);
    expect(needsCode(role(null, "Leads"))).toBe(true);
    expect(needsCode(role("sales"))).toBe(false);
    expect(needsCode(role("support"))).toBe(false);
    expect(needsCode(undefined)).toBe(false);
  });
});
