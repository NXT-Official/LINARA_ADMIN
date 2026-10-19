import type {
  ActivityKind,
  ContactSource,
  CustomerStage,
  HelperStatus,
  LeadStage,
  PayoutKind,
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
  in_app: "In-app",
  other: "Other",
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  account: "Account",
  tasks: "Tasks",
  pay: "Pay",
  payout: "Payout",
  app_bug: "App bug",
  billing: "Billing",
  deletion: "Deletion",
  other: "Other",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

export const PAYOUT_PROBLEM_LABEL: Record<PayoutKind, string> = {
  failed: "Failed",
  cancelled: "Cancelled at Xendit",
  unclear: "Unclear",
  stuck: "Stuck sending",
  no_answer: "No answer from Xendit",
};

/** LINARA's AI edge functions (add-ai-call-limits.sql). Unknown ones show as stored. */
export const AI_FEATURE_LABEL: Record<string, string> = {
  "route-utos": "Quick Utos",
  "generate-sop": "Routine writer",
  "parse-scheduler": "Scheduling",
  "simplify-sop": "Routine simplifier",
  "promote-voice-task": "Voice tasks",
  "transcribe-notes": "Voice notes",
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  failed: "Failed",
  ambiguous: "Unclear",
  sending: "Stuck sending",
};

/** Audit actions in words. Unknown actions show as stored. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "support.ticket_created": "Logged a ticket",
  "support.status_changed": "Changed a ticket's status",
  "support.assigned": "Assigned a ticket",
  "support.priority_changed": "Changed a ticket's priority",
  "support.links_changed": "Changed a ticket's links",
  "support.note_added": "Added a note to a ticket",
  "staff.added": "Added a team member",
  "staff.removed": "Removed a team member",
  "staff.role_changed": "Changed a member's role",
  "role.created": "Created a role",
  "role.updated": "Changed a role",
  "role.deleted": "Deleted a role",
  "pay.revealed": "Revealed pay details",
  "user.suspended": "Suspended a user",
  "user.unsuspended": "Unsuspended a user",
  "crm.contact_created": "Added a contact",
  "crm.contact_updated": "Edited a contact",
  "crm.stage_changed": "Changed a lead's stage",
  "crm.contact_linked": "Linked a contact to an account",
  "crm.contact_unlinked": "Unlinked a contact from an account",
  "crm.contact_deleted": "Deleted a lead",
  "crm.activity_added": "Logged an activity",
  "crm.follow_up_added": "Added a follow-up",
  "crm.follow_up_done": "Marked a follow-up done",
  "crm.exported": "Exported contacts with details",
  "crm.imported": "Imported leads",
  "crm.retention_ran": "Anonymised old leads",
  "billing.granted": "Granted a plan",
  "billing.marked_paid": "Marked an invoice paid",
  "billing.plan_saved": "Saved a plan",
  "billing.plan_status": "Changed a plan's status",
  "billing.settings_saved": "Changed the billing settings",
  "billing.revoked": "Revoked a plan",
  "finance.cost_saved": "Saved a cost entry",
  "finance.cost_deleted": "Deleted a cost entry",
  "finance.price_saved": "Saved an AI model price",
  "faq.saved": "Saved an FAQ",
  "faq.deleted": "Deleted an FAQ",
  "support.replied": "Replied to a ticket",
  "deletion.processed": "Processed a deletion",
  "auth.signed_in": "Signed in",
  "auth.signed_out": "Signed out",
  "export.downloaded": "Downloaded a CSV export",
};
