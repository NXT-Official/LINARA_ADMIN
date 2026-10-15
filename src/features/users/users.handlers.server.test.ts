import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import { getUserHandler, listUsersHandler } from "./users.handlers.server";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const row = (i: number) => ({
  user_id: `${ID.slice(0, -3)}${String(i).padStart(3, "0")}`,
  full_name: `Person ${i}`,
  email: `p${i}@example.com`,
  user_type: "helper",
  household_id: null,
  household_name: null,
  household_count: 0,
  joined_at: "2026-10-01T00:00:00Z",
  last_sign_in_at: null,
  suspended: false,
  devices: 0,
});

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("listUsersHandler (FR-US-1, FR-US-2, NFR-7)", () => {
  it("list checks users.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(listUsersHandler({ page: 0 })).resolves.toMatchObject({ code: "not_allowed" });
    expect(m.requireStaff).toHaveBeenCalledWith("users.view");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("list pages 50 with one extra row", async () => {
    m.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => row(i)), error: null });
    const res = await listUsersHandler({ page: 1 });
    expect(m.rpc).toHaveBeenCalledWith("staff_find_users", {
      p_search: null,
      p_kind: null,
      p_suspended: null,
      p_limit: 51,
      p_offset: 50,
    });
    expect(res).toMatchObject({ ok: true, hasMore: true });
    if (res.ok) {
      expect(res.users).toHaveLength(50);
      expect(res.users[0]).toEqual({
        userId: row(0).user_id,
        fullName: "Person 0",
        email: "p0@example.com",
        kind: "helper",
        householdId: null,
        householdName: null,
        householdCount: 0,
        joinedAt: "2026-10-01T00:00:00Z",
        lastSignInAt: null,
        suspended: false,
        devices: 0,
      });
    }
  });

  it("search is trimmed and bounded", async () => {
    await listUsersHandler({ page: 0, search: "  ab  " });
    expect(m.rpc).toHaveBeenCalledWith(
      "staff_find_users",
      expect.objectContaining({ p_search: "ab" }),
    );
    m.rpc.mockClear();
    for (const search of ["a", "x".repeat(101)]) {
      await expect(listUsersHandler({ page: 0, search })).resolves.toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("an empty search means no search", async () => {
    await listUsersHandler({ page: 0, search: "   " });
    expect(m.rpc).toHaveBeenCalledWith(
      "staff_find_users",
      expect.objectContaining({ p_search: null }),
    );
  });

  it("kind must be a known kind", async () => {
    await expect(listUsersHandler({ page: 0, kind: "owner" as never })).resolves.toMatchObject({
      code: "invalid_input",
    });
    await listUsersHandler({ page: 0, kind: "co_manager" });
    expect(m.rpc).toHaveBeenCalledWith(
      "staff_find_users",
      expect.objectContaining({ p_kind: "co_manager" }),
    );
  });

  it("the suspended filter goes to the server", async () => {
    await listUsersHandler({ page: 0, suspended: true });
    expect(m.rpc).toHaveBeenCalledWith(
      "staff_find_users",
      expect.objectContaining({ p_suspended: true }),
    );
  });

  it("a far-off page is refused", async () => {
    await expect(listUsersHandler({ page: 201 })).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a database error says nothing about itself", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    await expect(listUsersHandler({ page: 0 })).resolves.toEqual({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
  });
});

describe("getUserHandler (FR-US-3)", () => {
  it("malformed id is not found without a query", async () => {
    await expect(getUserHandler({ userId: "../etc" })).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.requireStaff).not.toHaveBeenCalled();
  });

  it("missing user is not_found", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getUserHandler({ userId: ID })).resolves.toMatchObject({ code: "not_found" });
    expect(m.requireStaff).toHaveBeenCalledWith("users.view");
    expect(m.rpc).toHaveBeenCalledWith("staff_get_user", { p_user_id: ID });
  });

  it("detail maps snake_case to UserDetail", async () => {
    m.rpc.mockResolvedValue({
      error: null,
      data: {
        user_id: ID,
        full_name: "Carla Dizon",
        email: "carla@example.com",
        user_type: "helper",
        joined_at: "2026-10-03T00:00:00Z",
        last_sign_in_at: null,
        suspended: false,
        devices: 1,
        memberships: [{ household_id: "h1", household_name: "Reyes home", role: "co_manager" }],
        jobs: [
          {
            helper_id: "hp1",
            household_id: "h1",
            household_name: "Reyes home",
            station: "Kitchen",
            employment: "live-in",
            status: "ACTIVE",
            started_on: "2026-09-01",
            ended_on: null,
            also_works_in: [{ household_id: "h2", household_name: "Cruz home" }],
          },
        ],
        deletion: { id: "d1", requested_at: "2026-10-10T00:00:00Z" },
      },
    });
    await expect(getUserHandler({ userId: ID })).resolves.toEqual({
      ok: true,
      user: {
        userId: ID,
        fullName: "Carla Dizon",
        email: "carla@example.com",
        kind: "helper",
        joinedAt: "2026-10-03T00:00:00Z",
        lastSignInAt: null,
        suspended: false,
        devices: 1,
        memberships: [{ householdId: "h1", householdName: "Reyes home", role: "co_manager" }],
        jobs: [
          {
            helperId: "hp1",
            householdId: "h1",
            householdName: "Reyes home",
            station: "Kitchen",
            employment: "live-in",
            status: "ACTIVE",
            startedOn: "2026-09-01",
            endedOn: null,
            alsoWorksIn: [{ householdId: "h2", householdName: "Cruz home" }],
          },
        ],
        deletion: { id: "d1", requestedAt: "2026-10-10T00:00:00Z" },
      },
    });
  });
});
