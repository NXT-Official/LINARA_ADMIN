import { describe, expect, it } from "vitest";

import * as sample from "@/data/sample";
import { listContacts } from "@/data/queries";
import { toCsv } from "@/lib/csv";
import { formatPeso } from "@/lib/format";

import { AUDIT_CSV } from "./audit/audit.export";
import { CONTACT_CSV } from "./crm/crm.export";
import type { ContactRow } from "./crm/crm.types";
import { deletionCsv } from "./deletions/deletions.export";
import { HOUSEHOLD_CSV } from "./households/households.export";
import type { HouseholdRow } from "./households/households.types";
import { PAYOUT_CSV } from "./payouts/payouts.export";
import { TICKET_CSV } from "./support/support.export";
import { USER_CSV } from "./users/users.export";
import type { UserRow } from "./users/users.types";

/**
 * FR-EX-1: the one-click exports carry no personal details, free text or pay
 * amounts. Every name, email, phone, note, subject, reason and amount in the
 * sample data is checked against every export.
 */
const now = new Date();
const householdName = (id: string | undefined) =>
  sample.households.find((h) => h.id === id)?.name ?? null;
/** The sample contacts as the real CRM list returns them (Phase 3a). */
const contactRows: ContactRow[] = listContacts(now).map((c) => ({
  contactId: c.virtual ? null : c.id,
  userId: c.userId,
  fullName: c.fullName,
  email: c.email,
  phone: c.phone,
  kind: c.kind,
  stage: c.stage,
  source: c.source,
  ownerId: c.ownerId,
  tags: c.tags,
  roles: [],
  householdCount: 1,
  nextFollowUpAt: c.nextFollowUp?.dueAt ?? null,
  createdAt: c.createdAt,
}));
/** The sample households as the real Households list returns them (Phase 2). */
const householdRows: HouseholdRow[] = sample.households.map((h) => {
  const primary = h.managers.find((m) => m.role === "primary_manager")?.userId ?? null;
  return {
    householdId: h.id,
    name: h.name,
    createdAt: h.createdAt,
    primaryManagerId: primary,
    primaryManagerName: sample.users.find((u) => u.id === primary)?.fullName ?? null,
    managers: h.managers.length,
    helpersActive: h.helpers.filter((x) => x.status === "ACTIVE").length,
    lastActivityAt: h.lastActivityAt,
    tasksScheduled7d: h.tasksCreated7d,
    tasksDone7d: h.tasksDone7d,
  };
});
/** The sample users as the real Users list returns them (Phase 2). */
const userRows: UserRow[] = sample.users.map((u) => ({
  userId: u.id,
  fullName: u.fullName,
  email: u.email,
  kind: u.kind,
  householdId: u.householdIds[0] ?? null,
  householdName: householdName(u.householdIds[0]),
  householdCount: u.householdIds.length,
  joinedAt: u.joinedAt,
  lastSignInAt: u.lastSignInAt,
  suspended: u.status === "suspended",
  devices: u.devices,
}));
const exports: Record<string, string> = {
  contacts: toCsv(CONTACT_CSV, contactRows),
  users: toCsv(USER_CSV, userRows),
  households: toCsv(HOUSEHOLD_CSV, householdRows),
  tickets: toCsv(TICKET_CSV, sample.tickets),
  deletions: toCsv(deletionCsv(now), sample.deletionRequests),
  payouts: toCsv(PAYOUT_CSV, sample.payouts),
  audit: toCsv(
    AUDIT_CSV,
    sample.auditLog.map((e) => ({
      ...e,
      targetType: e.targetType as string,
      targetId: e.targetId,
    })),
  ),
};

const forbidden: string[] = [
  ...sample.users.flatMap((u) => [u.fullName, u.email, u.phone]),
  ...sample.households.flatMap((h) => [h.name, ...h.helpers.map((x) => x.name)]),
  ...sample.contacts.flatMap((c) => [
    c.fullName,
    c.email,
    c.phone,
    c.consentBasis,
    c.lostReason,
    ...c.activities.map((a) => a.body),
    ...c.followUps.map((f) => f.note),
    ...c.tags,
  ]),
  ...sample.tickets.flatMap((t) => [
    t.subject,
    t.body,
    t.contactHandle,
    ...t.notes.map((n) => n.body),
  ]),
  ...sample.payouts.flatMap((p) => [p.helperName, p.reason, String(p.amount)]),
  ...sample.households.flatMap((h) => h.helpers.map((x) => String(x.monthlyRate))),
  ...sample.auditLog.map((e) => e.reason),
].filter((v): v is string => !!v);

describe("one-click exports (FR-EX-1)", () => {
  for (const [name, csv] of Object.entries(exports)) {
    it(`${name} has no personal details, free text or pay amounts`, () => {
      const lower = csv.toLowerCase();
      for (const value of forbidden) expect(lower).not.toContain(value.toLowerCase());
    });
  }

  it("has a header and a row per record", () => {
    expect(exports.users.split("\r\n")).toHaveLength(sample.users.length + 1);
    expect(exports.payouts.split("\r\n")).toHaveLength(sample.payouts.length + 1);
  });

  it("checks amounts as the screens show them too", () => {
    for (const p of sample.payouts) expect(exports.payouts).not.toContain(formatPeso(p.amount));
  });
});
