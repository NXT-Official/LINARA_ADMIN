import { ConsoleError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";

import {
  TICKET_CATEGORIES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from "./support.types";

/** What admins type into a ticket, checked before it reaches the database (FR-SP-1, FR-SP-2). */

const bad = (message: string) => new ConsoleError("invalid_input", message);
const text = (v: unknown) => String(v ?? "").trim();

/** A ticket's readable number (FR-SP-6). */
export const ticketRef = (ref: number) => `LIN-${ref}`;

export function optionalId(v: unknown, what: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (!isUuid(v)) throw bad(`Pick ${what} from the list.`);
  return v;
}

export function parseStatus(v: unknown): TicketStatus {
  if (!TICKET_STATUSES.includes(v as TicketStatus)) throw bad("Pick a status.");
  return v as TicketStatus;
}

export function parsePriority(v: unknown): TicketPriority {
  if (!TICKET_PRIORITIES.includes(v as TicketPriority)) throw bad("Pick a priority.");
  return v as TicketPriority;
}

export function parseNote(v: unknown): string {
  const body = text(v);
  if (!body) throw bad("Write the note.");
  if (body.length > 5000) throw bad("Keep a note to 5,000 characters.");
  return body;
}

export type TicketInput = {
  subject: string;
  body: string;
  channel: TicketChannel;
  category: TicketCategory;
  priority?: TicketPriority;
  contact?: string | null;
  userId?: string | null;
  householdId?: string | null;
  contactId?: string | null;
  assigneeId?: string | null;
};

export function parseTicketInput(input: TicketInput) {
  const subject = text(input.subject);
  if (!subject || subject.length > 160) throw bad("Write a subject of up to 160 characters.");
  const body = text(input.body);
  if (!body || body.length > 5000) throw bad("Write the details, up to 5,000 characters.");
  if (!TICKET_CHANNELS.includes(input.channel)) throw bad("Pick where the message came from.");
  if (!TICKET_CATEGORIES.includes(input.category)) throw bad("Pick a category.");
  const contact = text(input.contact);
  if (contact.length > 120) throw bad("Keep the contact to 120 characters.");
  return {
    subject,
    body,
    channel: input.channel,
    category: input.category,
    priority: input.priority === undefined ? ("normal" as const) : parsePriority(input.priority),
    contact: contact || null,
    userId: optionalId(input.userId, "a user"),
    householdId: optionalId(input.householdId, "a household"),
    contactId: optionalId(input.contactId, "a contact"),
    assigneeId: optionalId(input.assigneeId, "an admin"),
  };
}
