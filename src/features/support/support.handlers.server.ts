import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid, PAGE_SIZE, pageWindow, parsePage, parseSearch } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import {
  optionalId,
  parseNote,
  parseReply,
  parsePriority,
  parseStatus,
  parseTicketInput,
  type TicketInput,
} from "./support.input";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type SupportCounts,
  type TicketCategory,
  type TicketDetail,
  type TicketMessage,
  type TicketPriority,
  type TicketRow,
  type TicketStatus,
} from "./support.types";

/** Support tickets (§5.6, D31, D37): one function call each after the guard. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("support", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

const bad = (message: string) => new ConsoleError("invalid_input", message);
const NOT_FOUND = "There's no ticket with this address.";

function ticketId(v: unknown): string {
  if (!isUuid(v)) throw new ConsoleError("not_found", NOT_FOUND);
  return v;
}

type DbTicketRow = {
  ticket_id: string;
  ref: number | string;
  subject: string;
  channel: TicketRow["channel"];
  category: TicketRow["category"];
  priority: TicketRow["priority"];
  status: TicketRow["status"];
  user_id: string | null;
  household_id: string | null;
  contact_id: string | null;
  contact: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  note_count?: number;
  staff_unread?: number;
  last_message_at?: string | null;
};

export function toTicketRow(r: DbTicketRow): TicketRow {
  return {
    ticketId: r.ticket_id,
    ref: Number(r.ref),
    subject: r.subject,
    channel: r.channel,
    category: r.category,
    priority: r.priority,
    status: r.status,
    userId: r.user_id,
    householdId: r.household_id,
    contactId: r.contact_id,
    contact: r.contact,
    assigneeId: r.assignee_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    noteCount: r.note_count ?? 0,
    staffUnread: r.staff_unread ?? 0,
    lastMessageAt: r.last_message_at ?? null,
  };
}

export type ListTicketsInput = {
  page: number;
  search?: string;
  /** "active" is open or waiting on user. */
  status?: "active" | TicketStatus;
  assignee?: "mine" | "unassigned";
  category?: TicketCategory;
  priority?: TicketPriority;
  userId?: string;
  householdId?: string;
  contactId?: string;
};

export function listTicketsHandler(
  input: ListTicketsInput,
): Promise<{ ok: true; tickets: TicketRow[]; hasMore: boolean } | PublicError> {
  return run(async () => {
    const page = parsePage(input.page);
    const search = parseSearch(input.search);
    if (
      input.status !== undefined &&
      input.status !== "active" &&
      !TICKET_STATUSES.includes(input.status)
    ) {
      throw bad("Pick a status.");
    }
    if (
      input.assignee !== undefined &&
      input.assignee !== "mine" &&
      input.assignee !== "unassigned"
    ) {
      throw bad("Pick mine or unassigned.");
    }
    if (input.category !== undefined && !TICKET_CATEGORIES.includes(input.category)) {
      throw bad("Pick a category.");
    }
    if (input.priority !== undefined && !TICKET_PRIORITIES.includes(input.priority)) {
      throw bad("Pick a priority.");
    }
    const userId = optionalId(input.userId, "a user");
    const householdId = optionalId(input.householdId, "a household");
    const contactId = optionalId(input.contactId, "a contact");

    const staff = await requireStaff("support.view");
    const rows = await call<DbTicketRow[]>("support_list_tickets", {
      p_search: search,
      p_status: input.status ?? null,
      p_assignee: input.assignee === "mine" ? staff.userId : (input.assignee ?? null),
      p_category: input.category ?? null,
      p_priority: input.priority ?? null,
      p_user_id: userId,
      p_household_id: householdId,
      p_contact_id: contactId,
      ...pageWindow(page),
    });
    return {
      ok: true as const,
      hasMore: (rows ?? []).length > PAGE_SIZE,
      tickets: (rows ?? []).slice(0, PAGE_SIZE).map(toTicketRow),
    };
  });
}

type DbTicketDetail = DbTicketRow & {
  body: string;
  created_by: string;
  user_name: string | null;
  household_name: string | null;
  contact_name: string | null;
  notes: { id: string; author_id: string; body: string; created_at: string }[];
  messages?: {
    id: string;
    ticket_id: string;
    author_id: string;
    from_staff: boolean;
    body: string;
    created_at: string;
  }[];
  household_unread?: number;
};

export function getTicketHandler(input: {
  ticketId: string;
}): Promise<{ ok: true; ticket: TicketDetail } | PublicError> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    await requireStaff("support.view");
    const d = await call<DbTicketDetail | null>("support_get_ticket", { p_ticket_id: id });
    if (!d) throw new ConsoleError("not_found", NOT_FOUND);
    const { noteCount: _unused, ...row } = toTicketRow(d);
    return {
      ok: true as const,
      ticket: {
        ...row,
        body: d.body,
        createdBy: d.created_by,
        userName: d.user_name,
        householdName: d.household_name,
        contactName: d.contact_name,
        notes: d.notes.map((n) => ({
          id: n.id,
          authorId: n.author_id,
          body: n.body,
          createdAt: n.created_at,
        })),
        messages: (d.messages ?? []).map((g): TicketMessage => ({
          id: g.id,
          ticketId: g.ticket_id,
          authorId: g.author_id,
          fromStaff: g.from_staff,
          body: g.body,
          createdAt: g.created_at,
        })),
        householdUnread: d.household_unread ?? 0,
      },
    };
  });
}

export function supportCountsHandler(): Promise<{ ok: true; counts: SupportCounts } | PublicError> {
  return run(async () => {
    await requireStaff("support.view");
    const d = await call<SupportCounts | null>("support_counts", {});
    if (!d) throw new Error("support_counts returned nothing");
    return {
      ok: true as const,
      counts: { open: d.open, pending: d.pending, unassigned: d.unassigned },
    };
  });
}

// ---------------------------------------------------------------- Writes (support.write)

export function createTicketHandler(
  input: TicketInput,
): Promise<{ ok: true; ticketId: string } | PublicError> {
  return run(async () => {
    const t = parseTicketInput(input);
    const staff = await requireStaff("support.write");
    const id = await call<string>("support_create_ticket", {
      p_actor: staff.userId,
      p_subject: t.subject,
      p_body: t.body,
      p_channel: t.channel,
      p_category: t.category,
      p_priority: t.priority,
      p_contact: t.contact,
      p_user_id: t.userId,
      p_household_id: t.householdId,
      p_contact_id: t.contactId,
      p_assignee_id: t.assigneeId,
    });
    return { ok: true as const, ticketId: id };
  });
}

type Done = { ok: true } | PublicError;

export function setStatusHandler(input: { ticketId: string; status: TicketStatus }): Promise<Done> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const status = parseStatus(input.status);
    const staff = await requireStaff("support.write");
    await call("support_set_status", { p_actor: staff.userId, p_ticket_id: id, p_status: status });
    return { ok: true as const };
  });
}

export function assignHandler(input: {
  ticketId: string;
  assigneeId: string | null;
}): Promise<Done> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const assigneeId = optionalId(input.assigneeId, "an admin");
    const staff = await requireStaff("support.write");
    await call("support_assign", {
      p_actor: staff.userId,
      p_ticket_id: id,
      p_assignee_id: assigneeId,
    });
    return { ok: true as const };
  });
}

export function setPriorityHandler(input: {
  ticketId: string;
  priority: TicketPriority;
}): Promise<Done> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const priority = parsePriority(input.priority);
    const staff = await requireStaff("support.write");
    await call("support_set_priority", {
      p_actor: staff.userId,
      p_ticket_id: id,
      p_priority: priority,
    });
    return { ok: true as const };
  });
}

export function setLinksHandler(input: {
  ticketId: string;
  userId: string | null;
  householdId: string | null;
  contactId: string | null;
}): Promise<Done> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const links = {
      p_user_id: optionalId(input.userId, "a user"),
      p_household_id: optionalId(input.householdId, "a household"),
      p_contact_id: optionalId(input.contactId, "a contact"),
    };
    const staff = await requireStaff("support.write");
    await call("support_set_links", { p_actor: staff.userId, p_ticket_id: id, ...links });
    return { ok: true as const };
  });
}

export function addNoteHandler(input: {
  ticketId: string;
  body: string;
}): Promise<{ ok: true; id: string } | PublicError> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const body = parseNote(input.body);
    const staff = await requireStaff("support.write");
    const noteId = await call<string>("support_add_note", {
      p_actor: staff.userId,
      p_ticket_id: id,
      p_body: body,
    });
    return { ok: true as const, id: noteId };
  });
}

/** A reply in an in-app conversation, sent to the household (support.write). */
export function replyToTicketHandler(input: {
  ticketId: string;
  body: string;
}): Promise<{ ok: true; id: string } | PublicError> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const body = parseReply(input.body);
    const staff = await requireStaff("support.write");
    const messageId = await call<string>("support_reply", {
      p_actor: staff.userId,
      p_ticket_id: id,
      p_body: body,
    });
    return { ok: true as const, id: messageId };
  });
}

/** The team has seen the household's messages (support.view: reading is enough). */
export function markTicketReadHandler(input: { ticketId: string }): Promise<Done> {
  return run(async () => {
    const id = ticketId(input.ticketId);
    const staff = await requireStaff("support.view");
    await call("support_staff_mark_read", { p_actor: staff.userId, p_ticket_id: id });
    return { ok: true as const };
  });
}
