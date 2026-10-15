/**
 * The shapes the screens work with. Sample data fills them today; server
 * functions fill them from Supabase later (spec §8), without the pages changing.
 */

export type ManagerRole = "primary_manager" | "co_manager" | "remote_admin";
export type UserKind = ManagerRole | "helper";
export type AccountStatus = "active" | "suspended";

export type AppUser = {
  id: string;
  fullName: string;
  email: string;
  /** Helpers only: managers have no phone stored in Linara (§8.4). */
  phone: string | null;
  kind: UserKind;
  householdIds: string[];
  joinedAt: string;
  lastSignInAt: string | null;
  status: AccountStatus;
  devices: number;
};

export type HelperStatus = "ACTIVE" | "PENDING_CLAIM" | "INACTIVE";

export type HouseholdHelper = {
  id: string;
  userId: string | null;
  name: string;
  station: string;
  employment: "live-in" | "live-out";
  status: HelperStatus;
  startedOn: string;
  endedOn: string | null;
  monthlyRate: number;
};

export type Household = {
  id: string;
  name: string;
  createdAt: string;
  /** Last task created or marked done (D11). Null when there has never been one. */
  lastActivityAt: string | null;
  managers: { userId: string; role: ManagerRole }[];
  helpers: HouseholdHelper[];
  tasksCreated7d: number;
  tasksDone7d: number;
};

export type LeadStage = "new" | "contacted" | "interested" | "lost";
export type CustomerStage = "signed_up" | "set_up" | "active" | "at_risk" | "inactive";
export type ContactSource = "facebook" | "referral" | "event" | "walk_in" | "website" | "other";
export type ActivityKind = "call" | "message" | "email" | "meeting" | "note";

export type Activity = {
  id: string;
  kind: ActivityKind;
  body: string;
  occurredAt: string;
  authorId: string;
};

export type FollowUp = {
  id: string;
  dueAt: string;
  note: string;
  assigneeId: string;
  doneAt: string | null;
};

export type Contact = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: ContactSource | null;
  consentBasis: string | null;
  leadStage: LeadStage;
  lostReason: string | null;
  /** Set when linked to a manager account; the contact is then a customer. */
  userId: string | null;
  ownerId: string | null;
  tags: string[];
  createdAt: string;
  activities: Activity[];
  followUps: FollowUp[];
};

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketChannel = "messenger" | "viber" | "email" | "phone" | "other";
export type TicketCategory =
  "account" | "tasks" | "pay" | "payout" | "app_bug" | "deletion" | "other";
export type TicketPriority = "low" | "normal" | "high";

export type Ticket = {
  id: string;
  ref: number;
  subject: string;
  body: string;
  channel: TicketChannel;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  userId: string | null;
  householdId: string | null;
  contactId: string | null;
  contactHandle: string | null;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  notes: { id: string; authorId: string; body: string; createdAt: string }[];
};

export type DeletionRequest = {
  id: string;
  userId: string;
  kind: "manager" | "helper";
  requestedAt: string;
  status: "pending" | "done" | "cancelled";
  finishedAt: string | null;
  /** What process_account_deletion would refuse on (FR-DL-2). */
  blockers: string[];
};

export type PayoutStatus = "failed" | "ambiguous" | "sending";

export type Payout = {
  id: string;
  helperName: string;
  householdId: string;
  amount: number;
  status: PayoutStatus;
  reason: string;
  reference: string;
  createdAt: string;
};

export type AiFeature = {
  fn: string;
  label: string;
  /** Calls per hour for the last 24 hours, oldest first. */
  hourly: number[];
};

export type AiLimitHit = { userId: string; fn: string; limit: "hourly" | "daily"; at: string };

export type AuditEntry = {
  id: string;
  actorId: string;
  action: string;
  targetType:
    "user" | "household" | "ticket" | "contact" | "staff" | "helper" | "payout" | "export";
  targetId: string;
  reason: string | null;
  at: string;
};

export type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  role: "admin";
  lastSignInAt: string | null;
  twoStepSetUp: boolean;
  addedAt: string;
};
