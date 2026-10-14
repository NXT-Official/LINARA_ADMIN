import { customerStage } from "@/features/crm/crm-stage";
import { daysBetween } from "@/lib/format";

import * as sample from "./sample";
import type { AppUser, Contact, CustomerStage, Household, LeadStage, StaffMember } from "./types";

/**
 * What the screens read. Each function becomes a server function behind a
 * permission check (spec §7.3) in the phase that builds its screen; the pages
 * keep calling the same names.
 */

export const DELETION_DAYS = 30;

export function currentStaff(): StaffMember {
  return sample.staff.find((s) => s.id === sample.CURRENT_STAFF_ID)!;
}

export const listStaff = () => sample.staff;
export const staffById = (id: string | null) => sample.staff.find((s) => s.id === id) ?? null;

export const listUsers = () => sample.users;
export const userById = (id: string | null) => sample.users.find((u) => u.id === id) ?? null;

export const listHouseholds = () => sample.households;
export const householdById = (id: string | null) =>
  sample.households.find((h) => h.id === id) ?? null;

export function householdsOf(user: AppUser): Household[] {
  return user.householdIds.map((id) => householdById(id)).filter((h): h is Household => !!h);
}

export function primaryManagerOf(household: Household): AppUser | null {
  const m = household.managers.find((x) => x.role === "primary_manager");
  return m ? userById(m.userId) : null;
}

export function activeHelpers(household: Household) {
  return household.helpers.filter((h) => h.status === "ACTIVE");
}

// ---------------------------------------------------------------- CRM

export type ContactRow = Contact & {
  /** Not saved yet: a manager shown as a customer without anyone entering them (FR-CRM-3). */
  virtual: boolean;
  kind: "lead" | "customer";
  stage: LeadStage | CustomerStage;
  nextFollowUp: Contact["followUps"][number] | null;
};

function toRow(contact: Contact, virtual: boolean, now: Date): ContactRow {
  const user = userById(contact.userId);
  const open = contact.followUps
    .filter((f) => !f.doneAt)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return {
    ...contact,
    virtual,
    kind: user ? "customer" : "lead",
    stage: user ? customerStage(householdsOf(user), now) : contact.leadStage,
    nextFollowUp: open[0] ?? null,
  };
}

export function listContacts(now: Date = new Date()): ContactRow[] {
  const saved = sample.contacts.map((c) => toRow(c, false, now));
  const linked = new Set(sample.contacts.map((c) => c.userId).filter(Boolean));
  const virtual = sample.users
    .filter((u) => u.kind !== "helper" && !linked.has(u.id))
    .map((u) =>
      toRow(
        {
          id: `user-${u.id}`,
          fullName: u.fullName,
          email: u.email,
          phone: null,
          source: null,
          consentBasis: null,
          leadStage: "new",
          lostReason: null,
          userId: u.id,
          ownerId: null,
          tags: [],
          createdAt: u.joinedAt,
          activities: [],
          followUps: [],
        },
        true,
        now,
      ),
    );
  return [...saved, ...virtual];
}

export const contactById = (id: string) => listContacts().find((c) => c.id === id) ?? null;

export const contactForUser = (userId: string) =>
  listContacts().find((c) => c.userId === userId) ?? null;

/** A lead whose email matches a manager account, to suggest linking (FR-CRM-6). */
export function suggestedLink(contact: ContactRow): AppUser | null {
  if (contact.userId || !contact.email) return null;
  const email = contact.email.toLowerCase();
  return sample.users.find((u) => u.kind !== "helper" && u.email.toLowerCase() === email) ?? null;
}

// ---------------------------------------------------------------- Support, deletions, ops

export const listTickets = () => sample.tickets;
export const ticketById = (id: string) => sample.tickets.find((t) => t.id === id) ?? null;
export const ticketsFor = (q: { userId?: string; householdId?: string; contactId?: string }) =>
  sample.tickets.filter(
    (t) =>
      (q.userId && t.userId === q.userId) ||
      (q.householdId && t.householdId === q.householdId) ||
      (q.contactId && t.contactId === q.contactId),
  );

export const listDeletionRequests = () => sample.deletionRequests;

/** Days until the 30-day deadline; negative when past it. */
export function deletionDaysLeft(requestedAt: string, now: Date = new Date()): number {
  return DELETION_DAYS - daysBetween(requestedAt, now);
}

export const listPayouts = () => sample.payouts;
export const aiUsage = () => ({
  features: sample.aiFeatures,
  topUsers: sample.aiTopUsers,
  limitHits: sample.aiLimitHits,
});
export const listAudit = () => sample.auditLog;
export const auditFor = (targetId: string) =>
  sample.auditLog.filter((e) => e.targetId === targetId);

// ---------------------------------------------------------------- Aggregates for charts

export const tasksDoneDaily = () => sample.tasksDoneDaily;
export const newHouseholdsWeekly = () => sample.newHouseholdsWeekly;
export const ticketsByCategory30d = () => sample.ticketsByCategory30d;

export const ticketsByChannel30d = () => sample.ticketsByChannel30d;
