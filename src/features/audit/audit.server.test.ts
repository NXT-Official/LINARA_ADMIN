import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ from: () => ({ insert }) }),
}));

import { assertNoPersonalData, writeAudit } from "./audit.server";

describe("assertNoPersonalData (S-22)", () => {
  it("allows ids, counts and slugs", () => {
    expect(() => assertNoPersonalData({ rows: 12, slug: "users", ok: true })).not.toThrow();
    expect(() => assertNoPersonalData(undefined)).not.toThrow();
  });

  it("rejects an email, a phone number or an amount", () => {
    const cases: Record<string, string>[] = [
      { who: "ana@x.com" },
      { phone: "09171234567" },
      { pay: "₱6,500.00" },
    ];
    for (const metadata of cases) {
      expect(() => assertNoPersonalData(metadata)).toThrow(/personal data in audit metadata/);
    }
  });
});

describe("writeAudit", () => {
  beforeEach(() => insert.mockReset());

  it("writes the entry with database column names", async () => {
    insert.mockResolvedValue({ error: null });
    await writeAudit({
      actorId: "a",
      action: "staff.added",
      targetType: "staff",
      targetId: "b",
      reason: "New hire",
      metadata: { rows: 1 },
    });
    expect(insert).toHaveBeenCalledWith({
      actor_user_id: "a",
      action: "staff.added",
      target_type: "staff",
      target_id: "b",
      reason: "New hire",
      metadata: { rows: 1 },
    });
  });

  it("fails loudly when the entry can't be written", async () => {
    insert.mockResolvedValue({ error: { message: "db down" } });
    await expect(
      writeAudit({ actorId: "a", action: "x", targetType: "auth", targetId: "b" }),
    ).rejects.toMatchObject({ code: "outside_service" });
  });

  it("refuses personal data before writing", async () => {
    await expect(
      writeAudit({
        actorId: "a",
        action: "x",
        targetType: "auth",
        targetId: "b",
        metadata: { email: "ana@x.com" },
      }),
    ).rejects.toThrow(/personal data/);
    expect(insert).not.toHaveBeenCalled();
  });
});
