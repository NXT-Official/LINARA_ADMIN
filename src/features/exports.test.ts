import { describe, expect, it } from "vitest";

import * as sample from "@/data/sample";
import { listContacts } from "@/data/queries";
import { toCsv } from "@/lib/csv";
import { formatPeso } from "@/lib/format";

import { AI_HOURLY_CSV, AI_LIMIT_HITS_CSV, AI_TOP_USERS_CSV } from "./ai/ai.export";
import type { AiUsage } from "./ai/ai.types";

import { AUDIT_CSV } from "./audit/audit.export";
import { CONTACT_CSV } from "./crm/crm.export";
import type { ContactRow } from "./crm/crm.types";
import { DELETION_CSV } from "./deletions/deletions.export";
import type { DeletionRow } from "./deletions/deletions.types";
import { HOUSEHOLD_CSV } from "./households/households.export";
import type { HouseholdRow } from "./households/households.types";
import { PAYOUT_CSV } from "./payouts/payouts.export";
import type { PayoutProblem } from "./payouts/payouts.types";
import { TICKET_CSV } from "./support/support.export";
import type { TicketRow } from "./support/support.types";
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
/** The sample tickets as the real list returns them (Phase 5). */
const ticketRows: TicketRow[] = sample.tickets.map((t) => ({
  ticketId: t.id,
  ref: t.ref,
  subject: t.subject,
  channel: t.channel,
  category: t.category,
  priority: t.priority,
  status: t.status,
  userId: t.userId,
  householdId: t.householdId,
  contactId: t.contactId,
  contact: t.contactHandle,
  assigneeId: t.assigneeId,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  resolvedAt: null,
  noteCount: t.notes.length,
}));
/** The sample deletion requests as the real list returns them (Phase 4). */
const deletionRows: DeletionRow[] = sample.deletionRequests.map((r) => ({
  requestId: r.id,
  userId: r.userId,
  fullName: sample.users.find((u) => u.id === r.userId)?.fullName ?? null,
  userType: r.kind,
  status: r.status,
  requestedAt: r.requestedAt,
  dueAt: r.requestedAt,
  daysLeft: 5,
  processedAt: r.finishedAt,
  blockers: [],
}));
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
const PAYOUT_AMOUNT = 4321.5;
const payoutRows: PayoutProblem[] = [
  {
    attemptId: "a1",
    payslipId: "p1",
    attemptNumber: 2,
    kind: "failed",
    failureReason: "Recipient account Nena Payout-Helper is closed",
    referenceId: "ref-1",
    channelCode: "PH_GCASH",
    helperId: "h1",
    helperName: "Nena Payout-Helper",
    householdId: "hh1",
    householdName: "Payout Reyes Home",
    cutoffStart: "2026-10-01",
    cutoffEnd: "2026-10-15",
    createdAt: "2026-10-16T09:00:00Z",
  },
];
const aiUsage: AiUsage = {
  hourly: [{ fn: "route-utos", hour: "2026-10-16T10:00:00+00:00", calls: 4 }],
  topUsers: [{ userId: "u1", name: "Ana Top-Caller", calls: 40 }],
  limitHits: [
    {
      userId: "u1",
      name: "Ana Top-Caller",
      kind: "hourly",
      fn: "route-utos",
      at: "2026-10-16T10:59:00Z",
    },
  ],
  calls24h: 44,
};
const exports: Record<string, string> = {
  contacts: toCsv(CONTACT_CSV, contactRows),
  users: toCsv(USER_CSV, userRows),
  households: toCsv(HOUSEHOLD_CSV, householdRows),
  tickets: toCsv(TICKET_CSV, ticketRows),
  deletions: toCsv(DELETION_CSV, deletionRows),
  payouts: toCsv(PAYOUT_CSV, payoutRows),
  aiHourly: toCsv(AI_HOURLY_CSV, aiUsage.hourly),
  aiTopUsers: toCsv(AI_TOP_USERS_CSV, aiUsage.topUsers),
  aiLimitHits: toCsv(AI_LIMIT_HITS_CSV, aiUsage.limitHits),
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
  ...payoutRows.flatMap((p) => [p.helperName, p.householdName, p.failureReason]),
  String(PAYOUT_AMOUNT),
  "Ana Top-Caller",
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
    expect(exports.payouts.split("\r\n")).toHaveLength(payoutRows.length + 1);
    expect(exports.aiLimitHits.split("\r\n")).toHaveLength(2);
  });

  it("checks amounts as the screens show them too", () => {
    expect(exports.payouts).not.toContain(formatPeso(PAYOUT_AMOUNT));
  });
});
