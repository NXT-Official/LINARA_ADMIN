import type { ActivityKind, ContactSource, CustomerStage, LeadStage } from "@/data/types";
import type { UserKind } from "@/features/users/users.types";

/** What the CRM screens show (§5.2, FR-CRM-3 to FR-CRM-12). */

export type { ActivityKind, ContactSource, CustomerStage, LeadStage };

export type ContactKind = "lead" | "customer";
export type ManagerRole = Exclude<UserKind, "helper">;

export const LEAD_STAGES: readonly LeadStage[] = ["new", "contacted", "interested", "lost"];
export const CUSTOMER_STAGES: readonly CustomerStage[] = [
  "signed_up",
  "set_up",
  "active",
  "at_risk",
  "inactive",
];
export const SOURCES: readonly ContactSource[] = [
  "facebook",
  "referral",
  "event",
  "walk_in",
  "website",
  "other",
];
export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "call",
  "message",
  "email",
  "meeting",
  "note",
];
export const MANAGER_ROLES: readonly ManagerRole[] = [
  "primary_manager",
  "co_manager",
  "remote_admin",
];

export type ContactRow = {
  /** Null for a manager nobody has added anything to yet (FR-CRM-3). */
  contactId: string | null;
  userId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  kind: ContactKind;
  stage: LeadStage | CustomerStage;
  source: ContactSource | null;
  ownerId: string | null;
  tags: string[];
  roles: ManagerRole[];
  householdCount: number;
  nextFollowUpAt: string | null;
  createdAt: string;
};

export type ContactActivity = {
  id: string;
  kind: ActivityKind;
  body: string;
  occurredAt: string;
  authorId: string;
};

export type ContactFollowUp = {
  id: string;
  dueAt: string;
  note: string;
  assigneeId: string;
  doneAt: string | null;
};

export type ContactDetail = ContactRow & {
  leadStage: LeadStage | null;
  lostReason: string | null;
  consentBasis: string | null;
  linkedAt: string | null;
  households: {
    householdId: string;
    name: string;
    role: ManagerRole;
    stage: CustomerStage;
    lastActivityAt: string | null;
  }[];
  activities: ContactActivity[];
  followUps: ContactFollowUp[];
};

/** A saved contact, or a manager with no contact row yet. */
export type ContactRef = { contactId: string } | { userId: string };

export type LinkSuggestion = { userId: string; fullName: string | null; email: string };

export type CrmDashboard = {
  leadsByStage: Record<LeadStage, number>;
  customersByStage: Record<CustomerStage, number>;
  followUpsDueToday: number;
  followUpsOverdue: number;
  converted30d: number;
  sources: Record<ContactSource, number>;
};
