import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import { aiUsageHandler } from "./ai.handlers.server";

const NOW = new Date("2026-10-16T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.rpc.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("AI usage (FR-AI-1, FR-AI-2)", () => {
  it("checks ai.view first, uses the server's clock and maps the rows", async () => {
    m.rpc.mockResolvedValue({
      data: {
        hourly: [{ fn: "route-utos", hour: "2026-10-16T10:00:00+00:00", calls: 4 }],
        top_users: [{ user_id: "u1", name: "Ana", calls: 40 }],
        limit_hits: [
          {
            user_id: "u1",
            name: null,
            kind: "hourly",
            fn: "route-utos",
            at: "2026-10-16T10:59:00",
          },
        ],
        calls_24h: 120,
      },
      error: null,
    });
    const res = await aiUsageHandler();
    expect(m.requireStaff).toHaveBeenCalledWith("ai.view");
    expect(m.rpc).toHaveBeenCalledWith("staff_ai_usage", { p_now: NOW.toISOString() });
    expect(res).toEqual({
      ok: true,
      usage: {
        hourly: [{ fn: "route-utos", hour: "2026-10-16T10:00:00+00:00", calls: 4 }],
        topUsers: [{ userId: "u1", name: "Ana", calls: 40 }],
        limitHits: [
          { userId: "u1", name: null, kind: "hourly", fn: "route-utos", at: "2026-10-16T10:59:00" },
        ],
        calls24h: 120,
      },
    });
  });

  it("a refused permission stops before the database", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    const res = await aiUsageHandler();
    expect(res).toMatchObject({ ok: false, code: "not_allowed" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("other errors say nothing", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret detail" } });
    const res = await aiUsageHandler();
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("secret detail");
  });
});
