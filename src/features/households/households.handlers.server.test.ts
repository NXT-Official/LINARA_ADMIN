import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import { getHouseholdHandler, listHouseholdsHandler } from "./households.handlers.server";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const row = (i: number) => ({
  household_id: `h${i}`,
  name: `Home ${i}`,
  created_at: "2026-10-01T00:00:00Z",
  primary_manager_id: "u1",
  primary_manager_name: "Ana Reyes",
  managers: 2,
  helpers_active: 1,
  last_activity_at: null,
  tasks_scheduled_7d: 3,
  tasks_done_7d: 2,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T04:00:00Z"));
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("listHouseholdsHandler (FR-HH-1, NFR-7)", () => {
  it("list checks households.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(listHouseholdsHandler({ page: 0 })).resolves.toMatchObject({
      code: "not_allowed",
    });
    expect(m.requireStaff).toHaveBeenCalledWith("households.view");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("list pages 50 with one extra row, as of the server clock", async () => {
    m.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => row(i)), error: null });
    const res = await listHouseholdsHandler({ page: 2, search: " reyes " });
    expect(m.rpc).toHaveBeenCalledWith("staff_list_households", {
      p_search: "reyes",
      p_limit: 51,
      p_offset: 100,
      p_now: "2026-10-15T04:00:00.000Z",
    });
    expect(res).toMatchObject({ ok: true, hasMore: true });
    if (res.ok) {
      expect(res.households).toHaveLength(50);
      expect(res.households[0]).toEqual({
        householdId: "h0",
        name: "Home 0",
        createdAt: "2026-10-01T00:00:00Z",
        primaryManagerId: "u1",
        primaryManagerName: "Ana Reyes",
        managers: 2,
        helpersActive: 1,
        lastActivityAt: null,
        tasksScheduled7d: 3,
        tasksDone7d: 2,
      });
    }
  });

  it("search is bounded", async () => {
    await expect(listHouseholdsHandler({ page: 0, search: "a" })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("getHouseholdHandler (FR-HH-2)", () => {
  it("malformed id is not found without a query", async () => {
    await expect(getHouseholdHandler({ householdId: "nope" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("missing household is not_found", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getHouseholdHandler({ householdId: ID })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.requireStaff).toHaveBeenCalledWith("households.view");
    expect(m.rpc).toHaveBeenCalledWith("staff_get_household", {
      p_household_id: ID,
      p_now: "2026-10-15T04:00:00.000Z",
    });
  });

  it("detail maps snake_case to HouseholdDetail", async () => {
    m.rpc.mockResolvedValue({
      error: null,
      data: {
        household_id: ID,
        name: "Reyes home",
        created_at: "2026-10-12T01:00:00Z",
        timezone: "Asia/Manila",
        managers: [{ user_id: "u1", full_name: "Ana Reyes", role: "primary_manager" }],
        helpers: [
          {
            helper_id: "hp2",
            user_id: null,
            name: "Dina",
            station: "Laundry",
            employment: "live-out",
            status: "PENDING_CLAIM",
            started_on: null,
            ended_on: null,
            shared: false,
          },
        ],
        tasks_scheduled_7d: 1,
        tasks_done_7d: 1,
        tasks_done_30d: 4,
        last_activity_at: "2026-10-14T02:00:00Z",
      },
    });
    await expect(getHouseholdHandler({ householdId: ID })).resolves.toEqual({
      ok: true,
      household: {
        householdId: ID,
        name: "Reyes home",
        createdAt: "2026-10-12T01:00:00Z",
        timezone: "Asia/Manila",
        managers: [{ userId: "u1", fullName: "Ana Reyes", role: "primary_manager" }],
        helpers: [
          {
            helperId: "hp2",
            userId: null,
            name: "Dina",
            station: "Laundry",
            employment: "live-out",
            status: "PENDING_CLAIM",
            startedOn: null,
            endedOn: null,
            shared: false,
          },
        ],
        tasksScheduled7d: 1,
        tasksDone7d: 1,
        tasksDone30d: 4,
        lastActivityAt: "2026-10-14T02:00:00Z",
      },
    });
  });
});
