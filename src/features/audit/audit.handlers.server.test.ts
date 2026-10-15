import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  rate: vi.fn(),
  audit: vi.fn(),
  rows: [] as unknown[],
  calls: [] as [string, unknown[]][],
}));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/features/auth/rate-limit.server", () => ({
  checkRateLimit: (...a: unknown[]) => m.rate(...a),
}));
vi.mock("./audit.server", () => ({ writeAudit: (...a: unknown[]) => m.audit(...a) }));

/** A query builder that records every call and resolves to `m.rows`. */
function builder() {
  const b: Record<string, unknown> = {};
  for (const name of ["select", "order", "range", "eq", "gte", "lt"]) {
    b[name] = (...args: unknown[]) => {
      m.calls.push([name, args]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: m.rows, error: null });
  return b;
}
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ from: () => builder() }),
}));

import { ConsoleError } from "@/lib/console-error";

import { listAuditHandler, recordExportHandler } from "./audit.handlers.server";

const ACTOR = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";

const row = (i: number) => ({
  id: i,
  actor_user_id: "a",
  action: "staff.added",
  target_type: "staff",
  target_id: "b",
  reason: null,
  at: "2026-10-14T00:00:00Z",
});

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: "me" });
  m.rate.mockReset().mockResolvedValue(undefined);
  m.audit.mockReset().mockResolvedValue(undefined);
  m.rows = [];
  m.calls = [];
});

describe("listAuditHandler (FR-AU-1, D31)", () => {
  it("pages 50 at a time, newest first, without counting", async () => {
    m.rows = Array.from({ length: 51 }, (_, i) => row(i));
    const res = await listAuditHandler({ page: 1 });
    expect(m.requireStaff).toHaveBeenCalledWith("audit.view");
    expect(m.calls).toContainEqual(["order", ["at", { ascending: false }]]);
    expect(m.calls).toContainEqual(["range", [50, 100]]);
    const select = m.calls.find(([n]) => n === "select");
    expect(select?.[1]).toHaveLength(1); // no { count } option
    expect(res).toMatchObject({ ok: true, hasMore: true });
    if (res.ok) expect(res.entries).toHaveLength(50);
  });

  it("the last page says there's no more", async () => {
    m.rows = [row(1)];
    await expect(listAuditHandler({ page: 0 })).resolves.toMatchObject({
      ok: true,
      hasMore: false,
    });
  });

  it("dates are whole Manila days", async () => {
    await listAuditHandler({ page: 0, from: "2026-10-14", to: "2026-10-14" });
    expect(m.calls).toContainEqual(["gte", ["at", "2026-10-13T16:00:00.000Z"]]);
    expect(m.calls).toContainEqual(["lt", ["at", "2026-10-14T16:00:00.000Z"]]);
  });

  it("filters by person, action and target", async () => {
    await listAuditHandler({ page: 0, actorId: ACTOR, action: "staff.added", targetType: "staff" });
    expect(m.calls).toContainEqual(["eq", ["actor_user_id", ACTOR]]);
    expect(m.calls).toContainEqual(["eq", ["action", "staff.added"]]);
    expect(m.calls).toContainEqual(["eq", ["target_type", "staff"]]);
  });

  it("refuses a malformed date before querying", async () => {
    await expect(listAuditHandler({ page: 0, from: "14/10/2026" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(m.calls).toEqual([]);
  });

  it("filters by record", async () => {
    await listAuditHandler({ page: 0, targetId: ACTOR });
    expect(m.calls).toContainEqual(["eq", ["target_id", ACTOR]]);
  });

  it("refuses a malformed record id", async () => {
    await expect(listAuditHandler({ page: 0, targetId: "a b" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(m.calls).toEqual([]);
  });

  it("refuses malformed filters and far-off pages before querying", async () => {
    for (const input of [
      { page: 0, actorId: "not-a-uuid" },
      { page: 0, action: "x".repeat(200) },
      { page: 0, targetType: "staff' or 1=1" },
      { page: 1_000_000 },
    ]) {
      await expect(listAuditHandler(input)).resolves.toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    expect(m.calls).toEqual([]);
  });
});

describe("recordExportHandler (FR-EX-3)", () => {
  it("records an export with its size only", async () => {
    await expect(recordExportHandler({ slug: "users", rows: 12 })).resolves.toEqual({ ok: true });
    expect(m.audit).toHaveBeenCalledWith({
      actorId: "me",
      action: "export.downloaded",
      targetType: "export",
      targetId: "users",
      metadata: { rows: 12 },
    });
  });

  it("export records reject bad input", async () => {
    for (const input of [
      { slug: "../x", rows: 1 },
      { slug: "users", rows: -1 },
      { slug: "users", rows: 1.5 },
    ]) {
      await expect(recordExportHandler(input)).resolves.toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("exports are rate limited", async () => {
    m.rate.mockRejectedValue(
      new ConsoleError("conflict", "Too many tries. Wait 60 minutes, then try again."),
    );
    await expect(recordExportHandler({ slug: "users", rows: 1 })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "Too many tries. Wait 60 minutes, then try again.",
    });
    expect(m.audit).not.toHaveBeenCalled();
  });
});
