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
  deletionCountsHandler,
  listDeletionsHandler,
  processDeletionHandler,
} from "./deletions.handlers.server";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const REQ = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const NOW = "2026-10-15T04:00:00.000Z";
const dbRow = (i: number) => ({
  request_id: `r${i}`,
  user_id: `u${i}`,
  full_name: i === 0 ? null : `Person ${i}`,
  user_type: "helper",
  status: "pending",
  requested_at: "2026-09-20T00:00:00Z",
  due_at: "2026-10-20T00:00:00Z",
  days_left: 5,
  processed_at: null,
  blockers: i === 1 ? ["active_employment"] : [],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  m.order = [];
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.code.mockReset().mockResolvedValue(undefined);
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("listDeletionsHandler (FR-DL-1, FR-DL-7)", () => {
  it("lists check deletions.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(listDeletionsHandler({ view: "pending", page: 0 })).resolves.toMatchObject({
      code: "not_allowed",
    });
    expect(m.requireStaff).toHaveBeenCalledWith("deletions.view");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("pending and history pass through with paging", async () => {
    m.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => dbRow(i)), error: null });
    const res = await listDeletionsHandler({ view: "history", page: 1 });
    expect(m.rpc).toHaveBeenCalledWith("staff_list_deletion_requests", {
      p_view: "history",
      p_limit: 51,
      p_offset: 50,
      p_now: NOW,
    });
    expect(res).toMatchObject({ ok: true, hasMore: true });
    if (res.ok) {
      expect(res.requests).toHaveLength(50);
      expect(res.requests[1]).toEqual({
        requestId: "r1",
        userId: "u1",
        fullName: "Person 1",
        userType: "helper",
        status: "pending",
        requestedAt: "2026-09-20T00:00:00Z",
        dueAt: "2026-10-20T00:00:00Z",
        daysLeft: 5,
        processedAt: null,
        blockers: ["active_employment"],
      });
    }
  });

  it("refuses an unknown view", async () => {
    await expect(listDeletionsHandler({ view: "all" as never, page: 0 })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("deletionCountsHandler (FR-DB-4)", () => {
  it("maps the counts", async () => {
    m.rpc.mockResolvedValue({ data: { pending: 4, due_soon: 1, overdue: 2 }, error: null });
    await expect(deletionCountsHandler()).resolves.toEqual({
      ok: true,
      counts: { pending: 4, dueSoon: 1, overdue: 2 },
    });
    expect(m.requireStaff).toHaveBeenCalledWith("deletions.view");
  });
});

describe("processDeletionHandler (FR-DL-3, FR-DL-4, S-5, D36)", () => {
  it("process checks deletions.process then the code", async () => {
    m.rpc.mockResolvedValue({ data: { user_id: "u1", household_deleted: false }, error: null });
    await expect(processDeletionHandler({ requestId: REQ, code: "123456" })).resolves.toEqual({
      ok: true,
      result: { user_id: "u1", household_deleted: false },
    });
    expect(m.requireStaff).toHaveBeenCalledWith("deletions.process");
    expect(m.order).toEqual(["guard", "code", "rpc:staff_process_deletion"]);
    expect(m.rpc).toHaveBeenCalledWith("staff_process_deletion", {
      p_actor: ME,
      p_request_id: REQ,
    });
  });

  it("the main app's refusal is shown as it is", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message:
          "Her employment is still active. Ask the household to end it (with final pay) first.",
      },
    });
    await expect(processDeletionHandler({ requestId: REQ, code: "123456" })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message:
        "Her employment is still active. Ask the household to end it (with final pay) first.",
    });
  });

  it("a wrong code stops before anything runs", async () => {
    m.code.mockRejectedValue(new ConsoleError("invalid_input", "That code didn't work."));
    await expect(processDeletionHandler({ requestId: REQ, code: "000000" })).resolves.toMatchObject(
      { code: "invalid_input" },
    );
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("malformed ids are not found without a query", async () => {
    await expect(processDeletionHandler({ requestId: "x", code: "123456" })).resolves.toMatchObject(
      { code: "not_found" },
    );
    expect(m.requireStaff).not.toHaveBeenCalled();
  });
});
