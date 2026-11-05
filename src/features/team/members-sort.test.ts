import { describe, expect, it } from "vitest";

import { sortMembers } from "./members-sort";
import type { AdminRow } from "./team.handlers.server";

const member = (
  email: string,
  preset: AdminRow["preset"],
  roleName: string,
  lastSignInAt: string | null,
  addedAt: string,
): AdminRow => ({
  userId: email,
  email,
  addedAt,
  lastSignInAt,
  twoStepSetUp: true,
  isYou: false,
  roleId: roleName,
  roleName,
  preset,
});

const TEAM = [
  member("sales@x.com", "sales", "Sales", "2026-10-18T00:00:00Z", "2026-10-15T00:00:00Z"),
  member("b-admin@x.com", "admin", "Admin", null, "2026-10-14T00:00:00Z"),
  member("lead@x.com", null, "Lead desk", "2026-10-19T00:00:00Z", "2026-10-17T00:00:00Z"),
  member(
    "owner@x.com",
    "super_admin",
    "Super admin",
    "2026-10-19T02:00:00Z",
    "2026-10-19T00:00:00Z",
  ),
  member("a-admin@x.com", "admin", "Admin", "2026-10-16T00:00:00Z", "2026-10-16T00:00:00Z"),
  member("mod@x.com", "mods", "Mods", "2026-10-17T00:00:00Z", "2026-10-13T00:00:00Z"),
  member("audit@x.com", null, "Auditors", null, "2026-10-12T00:00:00Z"),
];
const emails = (rows: AdminRow[]) => rows.map((r) => r.email);

describe("sortMembers", () => {
  it("by role: most access first, custom roles by name, ties by email", () => {
    expect(emails(sortMembers(TEAM, "role"))).toEqual([
      "owner@x.com",
      "a-admin@x.com",
      "b-admin@x.com",
      "mod@x.com",
      "sales@x.com",
      "audit@x.com",
      "lead@x.com",
    ]);
  });

  it("by email", () => {
    expect(emails(sortMembers(TEAM, "email"))[0]).toBe("a-admin@x.com");
    expect(emails(sortMembers(TEAM, "email")).at(-1)).toBe("sales@x.com");
  });

  it("by last sign-in: newest first, never signed in last", () => {
    expect(emails(sortMembers(TEAM, "signIn"))).toEqual([
      "owner@x.com",
      "lead@x.com",
      "sales@x.com",
      "mod@x.com",
      "a-admin@x.com",
      "audit@x.com",
      "b-admin@x.com",
    ]);
  });

  it("by added: newest first, and leaves the input alone", () => {
    const before = emails(TEAM);
    expect(emails(sortMembers(TEAM, "added"))[0]).toBe("owner@x.com");
    expect(emails(TEAM)).toEqual(before);
  });
});
