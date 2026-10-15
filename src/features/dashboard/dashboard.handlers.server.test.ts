import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import { getDashboardHandler } from "./dashboard.handlers.server";

const DB = {
  households: 12,
  households_new_7d: 1,
  households_new_30d: 3,
  households_active_7d: 5,
  managers: 9,
  managers_multi_home: 2,
  helpers_active: 6,
  helpers_invited: 1,
  helpers_ended: 2,
  new_households_weekly: [{ week_start: "2026-10-12", count: 1 }],
  tasks_done_daily: [{ day: "2026-10-15", count: 4 }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T04:00:00Z"));
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.rpc.mockReset().mockResolvedValue({ data: DB, error: null });
});

describe("getDashboardHandler (FR-DB-1 to FR-DB-3)", () => {
  it("dashboard checks dashboard.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(getDashboardHandler()).resolves.toMatchObject({ code: "not_allowed" });
    expect(m.requireStaff).toHaveBeenCalledWith("dashboard.view");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's json in one call", async () => {
    await expect(getDashboardHandler()).resolves.toEqual({
      ok: true,
      data: {
        households: 12,
        householdsNew7d: 1,
        householdsNew30d: 3,
        householdsActive7d: 5,
        managers: 9,
        managersMultiHome: 2,
        helpersActive: 6,
        helpersInvited: 1,
        helpersEnded: 2,
        newHouseholdsWeekly: [{ weekStart: "2026-10-12", count: 1 }],
        tasksDoneDaily: [{ day: "2026-10-15", count: 4 }],
      },
    });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("staff_dashboard", { p_now: "2026-10-15T04:00:00.000Z" });
  });

  it("a database error says nothing about itself", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(getDashboardHandler()).resolves.toMatchObject({
      ok: false,
      code: "outside_service",
    });
  });
});
