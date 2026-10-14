import type {
  ActivityKind,
  ContactSource,
  CustomerStage,
  HelperStatus,
  LeadStage,
  PayoutStatus,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  UserKind,
} from "./types";

export const USER_KIND_LABEL: Record<UserKind, string> = {
  primary_manager: "Primary manager",
  co_manager: "Co-manager",
  remote_admin: "Remote admin",
  helper: "Helper",
};

export const HELPER_STATUS_LABEL: Record<HelperStatus, string> = {
  ACTIVE: "Active",
  PENDING_CLAIM: "Invited",
  INACTIVE: "Ended",
};

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  lost: "Lost",
};

export const CUSTOMER_STAGE_LABEL: Record<CustomerStage, string> = {
  signed_up: "Signed up",
  set_up: "Set up",
  active: "Active",
  at_risk: "At risk",
  inactive: "Inactive",
};

export const SOURCE_LABEL: Record<ContactSource, string> = {
  facebook: "Facebook",
  referral: "Referral",
  event: "Event",
  walk_in: "Walk-in",
  website: "Website",
  other: "Other",
};

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  call: "Call",
  message: "Message",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Waiting on user",
  resolved: "Resolved",
  closed: "Closed",
};

export const CHANNEL_LABEL: Record<TicketChannel, string> = {
  messenger: "Messenger",
  viber: "Viber",
  email: "Email",
  phone: "Phone",
  other: "Other",
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  account: "Account",
  tasks: "Tasks",
  pay: "Pay",
  payout: "Payout",
  app_bug: "App bug",
  deletion: "Deletion",
  other: "Other",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  failed: "Failed",
  ambiguous: "Unclear",
  sending: "Stuck sending",
};

/** Audit actions in words. Unknown actions show as stored. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "ticket.assigned": "Assigned a ticket",
  "staff.added": "Added an admin",
  "staff.removed": "Removed an admin",
  "pay.revealed": "Revealed pay details",
  "user.suspended": "Suspended a user",
  "user.unsuspended": "Unsuspended a user",
  "crm.contact_linked": "Linked a contact to an account",
  "crm.exported": "Exported contacts",
  "deletion.processed": "Processed a deletion",
};
