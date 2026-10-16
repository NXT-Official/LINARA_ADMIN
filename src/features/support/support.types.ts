import type { TicketCategory, TicketChannel, TicketPriority, TicketStatus } from "@/data/types";

/** Support tickets logged by admins from other channels (§5.6, D6, D37). */

export type { TicketCategory, TicketChannel, TicketPriority, TicketStatus };

export const TICKET_STATUSES: readonly TicketStatus[] = ["open", "pending", "resolved", "closed"];
export const TICKET_CHANNELS: readonly TicketChannel[] = [
  "messenger",
  "viber",
  "email",
  "phone",
  "other",
];
export const TICKET_CATEGORIES: readonly TicketCategory[] = [
  "account",
  "tasks",
  "pay",
  "payout",
  "app_bug",
  "deletion",
  "other",
];
export const TICKET_PRIORITIES: readonly TicketPriority[] = ["low", "normal", "high"];

export type TicketRow = {
  ticketId: string;
  ref: number;
  subject: string;
  channel: TicketChannel;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  userId: string | null;
  householdId: string | null;
  contactId: string | null;
  /** A free-text handle such as a Messenger name. */
  contact: string | null;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  noteCount: number;
};

export type TicketNote = { id: string; authorId: string; body: string; createdAt: string };

export type TicketDetail = Omit<TicketRow, "noteCount"> & {
  body: string;
  createdBy: string;
  userName: string | null;
  householdName: string | null;
  contactName: string | null;
  notes: TicketNote[];
};

export type SupportCounts = { open: number; pending: number; unassigned: number };
