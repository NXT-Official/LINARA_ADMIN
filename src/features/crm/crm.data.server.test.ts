import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  order: [] as string[],
  requireStaff: vi.fn(),
  rate: vi.fn(),
  code: vi.fn(),
  audit: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => {
    m.order.push("guard");
    return m.requireStaff(...a);
  },
}));
vi.mock("@/features/auth/rate-limit.server", () => ({
  checkRateLimit: (...a: unknown[]) => {
    m.order.push("rate");
    return m.rate(...a);
  },
}));
vi.mock("@/features/auth/reauth.server", () => ({
  requireFreshCode: (...a: unknown[]) => {
    m.order.push("code");
    return m.code(...a);
  },
}));
vi.mock("@/features/audit/audit.server", () => ({
  writeAudit: (...a: unknown[]) => {
    m.order.push("audit");
    return m.audit(...a);
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
  exportContactsHandler,
  findDuplicatesHandler,
  importLeadsHandler,
} from "./crm.data.server";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const contact = (i: number) => ({
  contact_id: `c${i}`,
  user_id: null,
  full_name: `Person ${i}`,
  email: `p${i}@example.com`,
  phone: null,
  kind: "lead",
  stage: "new",
  source: "facebook",
  owner_id: null,
  tags: ["OFW"],
  roles: [],
  household_count: 0,
  next_follow_up_at: null,
  created_at: "2026-10-01T00:00:00Z",
});

beforeEach(() => {
  m.order = [];
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.rate.mockReset().mockResolvedValue(undefined);
  m.code.mockReset().mockResolvedValue(undefined);
  m.audit.mockReset().mockResolvedValue(undefined);
  m.rpc.mockReset().mockResolvedValue({ data: 2, error: null });
});

describe("importLeadsHandler (FR-CRM-10, S-24)", () => {
  const good = { fullName: "Nina", email: "NINA@example.com", tags: "OFW", note: "Hi" };

  it("import checks crm.write", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(
      importLeadsHandler({ rows: [good], consentBasis: "Met at the expo" }),
    ).resolves.toMatchObject({ code: "not_allowed" });
    expect(m.requireStaff).toHaveBeenCalledWith("crm.write");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("one bad row refuses the import with its row number", async () => {
    await expect(
      importLeadsHandler({
        rows: [good, { fullName: "Paolo" }],
        consentBasis: "Met at the expo",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      message: "Row 2: A lead needs an email or a phone number.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing consent basis and more than 500 rows", async () => {
    await expect(importLeadsHandler({ rows: [good], consentBasis: " ok " })).resolves.toMatchObject(
      { code: "invalid_input" },
    );
    await expect(
      importLeadsHandler({
        rows: Array.from({ length: 501 }, () => good),
        consentBasis: "Met at the expo",
      }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("import sends cleaned rows and the consent basis", async () => {
    await expect(
      importLeadsHandler({ rows: [good], consentBasis: "  Met at the expo " }),
    ).resolves.toEqual({ ok: true, imported: 2 });
    expect(m.rpc).toHaveBeenCalledWith("crm_import_leads", {
      p_actor: ME,
      p_rows: [
        {
          full_name: "Nina",
          email: "nina@example.com",
          phone: null,
          source: null,
          tags: ["OFW"],
          note: "Hi",
        },
      ],
      p_consent: "Met at the expo",
    });
  });
});

describe("findDuplicatesHandler", () => {
  it("looks up emails and phones in one call", async () => {
    m.rpc.mockResolvedValue({
      data: [{ email: "lia@example.com", phone: null, contact_id: "c1" }],
      error: null,
    });
    await expect(
      findDuplicatesHandler({ emails: ["Lia@Example.com", ""], phones: ["0917 123 4567"] }),
    ).resolves.toEqual({ ok: true, matches: [{ email: "lia@example.com", phone: null }] });
    expect(m.rpc).toHaveBeenCalledWith("crm_find_duplicates", {
      p_emails: ["lia@example.com"],
      p_phones: ["09171234567"],
    });
  });
});

describe("exportContactsHandler (FR-CRM-11, S-5, S-18)", () => {
  it("export checks crm.export, then the rate limit, then the code", async () => {
    m.rpc.mockResolvedValue({ data: { total: 1, rows: [contact(1)] }, error: null });
    const res = await exportContactsHandler({ filters: { kind: "lead" }, code: "123456" });
    expect(res).toMatchObject({ ok: true });
    expect(m.requireStaff).toHaveBeenCalledWith("crm.export");
    expect(m.rate).toHaveBeenCalledWith("export", { adminId: ME });
    expect(m.order).toEqual(["guard", "rate", "code", "rpc:crm_export_contacts", "audit"]);
    if (res.ok)
      expect(res.rows[0]).toMatchObject({ fullName: "Person 1", email: "p1@example.com" });
  });

  it("export needs a fresh code", async () => {
    m.code.mockRejectedValue(
      new ConsoleError(
        "invalid_input",
        "That code didn't work. Check your authenticator app and try again.",
      ),
    );
    await expect(exportContactsHandler({ filters: {}, code: "000000" })).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      message: "That code didn't work. Check your authenticator app and try again.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("export records the count and filters but not the search text", async () => {
    m.rpc.mockResolvedValue({ data: { total: 2, rows: [contact(1), contact(2)] }, error: null });
    await exportContactsHandler({
      filters: { kind: "lead", stage: "new", owner: "mine", search: "Santos" },
      code: "123456",
    });
    expect(m.audit).toHaveBeenCalledWith({
      actorId: ME,
      action: "crm.exported",
      targetType: "export",
      targetId: "crm-contacts-with-details",
      metadata: {
        rows: 2,
        kind: "lead",
        stage: "new",
        owner_mine: true,
        has_search: true,
      },
    });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("Santos");
  });

  it("export caps at 5,000 rows, judged by the true total", async () => {
    m.rpc.mockResolvedValue({
      data: { total: 5001, rows: Array.from({ length: 5000 }, (_, i) => contact(i)) },
      error: null,
    });
    await expect(exportContactsHandler({ filters: {}, code: "123456" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(m.rpc).toHaveBeenCalledWith(
      "crm_export_contacts",
      expect.objectContaining({ p_max: 5000 }),
    );
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("a file shorter than the total never leaves the server", async () => {
    // e.g. an API row cap cutting the result: the count and the rows must agree.
    m.rpc.mockResolvedValue({
      data: { total: 3200, rows: Array.from({ length: 1000 }, (_, i) => contact(i)) },
      error: null,
    });
    await expect(exportContactsHandler({ filters: {}, code: "123456" })).resolves.toMatchObject({
      ok: false,
      code: "outside_service",
    });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("refuses unknown filters before the code is checked", async () => {
    await expect(
      exportContactsHandler({ filters: { stage: "won" }, code: "123456" }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.code).not.toHaveBeenCalled();
  });
});
