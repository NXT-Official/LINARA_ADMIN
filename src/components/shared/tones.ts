import type {
  AccountStatus,
  CustomerStage,
  HelperStatus,
  LeadStage,
  PayoutStatus,
  TicketPriority,
  TicketStatus,
} from "@/data/types";

import type { ChipTone } from "./status-chip";

/** One colour per meaning, used the same way on every screen. */
export const STAGE_TONE: Record<LeadStage | CustomerStage, ChipTone> = {
  new: "attention",
  contacted: "neutral",
  interested: "neutral",
  lost: "quiet",
  signed_up: "neutral",
  set_up: "neutral",
  active: "done",
  at_risk: "late",
  inactive: "quiet",
};

export const TICKET_STATUS_TONE: Record<TicketStatus, ChipTone> = {
  open: "attention",
  pending: "neutral",
  resolved: "done",
  closed: "quiet",
};

export const PRIORITY_TONE: Record<TicketPriority, ChipTone> = {
  low: "quiet",
  normal: "neutral",
  high: "late",
};

export const HELPER_STATUS_TONE: Record<HelperStatus, ChipTone> = {
  ACTIVE: "done",
  PENDING_CLAIM: "attention",
  INACTIVE: "quiet",
};

export const ACCOUNT_STATUS_TONE: Record<AccountStatus, ChipTone> = {
  active: "neutral",
  suspended: "danger",
};

export const PAYOUT_STATUS_TONE: Record<PayoutStatus, ChipTone> = {
  failed: "danger",
  ambiguous: "late",
  sending: "attention",
};
