import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  send: vi.fn(),
  members: [] as { email: string; role_id: string }[],
  managing: [] as { id: string }[],
  contains: vi.fn(),
  log: vi.fn(),
  appEnv: "staging" as "development" | "staging" | "production",
}));

vi.mock("@/lib/email.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/email.server")>()),
  sendEmails: (...a: unknown[]) => m.send(...a),
}));
vi.mock("@/lib/log.server", () => ({ logError: (...a: unknown[]) => m.log(...a) }));
vi.mock("@/lib/server-env.server", () => ({
  serverEnv: () => ({ siteUrl: "https://console.example.com", appEnv: m.appEnv }),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    rpc: async () => ({ data: m.members, error: null }),
    from: () => ({
      select: () => ({
        contains: (...a: unknown[]) => {
          m.contains(...a);
          return Promise.resolve({ data: m.managing, error: null });
        },
      }),
    }),
  }),
}));

import {
  notifyContactsExported,
  notifyMemberAdded,
  notifyMemberRemoved,
} from "./team-notify.server";

type Sent = { to: string; subject: string; text: string; html: string };
const sent = (): Sent[] => m.send.mock.calls[0][0];

beforeEach(() => {
  m.send.mockReset().mockResolvedValue("sent");
  m.log.mockReset();
  m.contains.mockReset();
  m.appEnv = "staging";
  m.members = [
    { email: "owner@x.com", role_id: "super" },
    { email: "admin@x.com", role_id: "admin" },
    { email: "sales@x.com", role_id: "sales" },
  ];
  m.managing = [{ id: "super" }, { id: "admin" }];
});

describe("team emails (FR-TM-4, FR-CRM-11, D45)", () => {
  it("go to every member whose role manages the team, one email each", async () => {
    await notifyMemberAdded({
      actorEmail: "admin@x.com",
      memberEmail: "new@x.com",
      roleName: "Support",
    });
    expect(m.contains).toHaveBeenCalledWith("permissions", ["team.manage"]);
    expect(sent().map((e) => e.to)).toEqual(["owner@x.com", "admin@x.com"]);
    expect(sent()[0].subject).toBe("[Staging] Team member added: new@x.com");
    expect(sent()[0].text).toContain(
      "admin@x.com added new@x.com to the Business Console team as Support",
    );
    expect(sent()[0].text).toContain("https://console.example.com/audit");
    // Branded HTML: a details table and a button to the audit log.
    expect(sent()[0].html).toContain("A team member was added");
    expect(sent()[0].html).toContain(">New member<");
    expect(sent()[0].html).toContain('href="https://console.example.com/audit"');
    expect(sent()[0].html).toContain("Open the audit log");
  });

  it("production subjects carry no environment tag", async () => {
    m.appEnv = "production";
    await notifyMemberRemoved({ actorEmail: "owner@x.com", memberEmail: "old@x.com" });
    expect(sent()[0].subject).toBe("Team member removed: old@x.com");
    expect(sent()[0].text).toContain("They were signed out everywhere.");
  });

  it("the export email has the count, never a customer's details", async () => {
    await notifyContactsExported({ actorEmail: "admin@x.com", rows: 42 });
    expect(sent()[0].subject).toBe("[Staging] CRM contacts exported with contact details");
    expect(sent()[0].text).toContain("admin@x.com downloaded 42 CRM contacts");
  });

  it("text in the HTML part is escaped", async () => {
    await notifyMemberAdded({
      actorEmail: "admin@x.com",
      memberEmail: "new@x.com",
      roleName: "<script>x</script>",
    });
    expect(sent()[0].html).not.toContain("<script>");
    expect(sent()[0].html).toContain("&lt;script&gt;");
  });

  it("a failed email is logged and never fails the action", async () => {
    m.send.mockRejectedValue(new Error("Resend 500"));
    await expect(
      notifyMemberRemoved({ actorEmail: "owner@x.com", memberEmail: "old@x.com" }),
    ).resolves.toBeUndefined();
    expect(m.log).toHaveBeenCalledWith("team email", expect.any(Error));
  });
});
