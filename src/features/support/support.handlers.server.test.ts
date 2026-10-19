import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import {
  addNoteHandler,
  markTicketReadHandler,
  replyToTicketHandler,
  assignHandler,
  createTicketHandler,
  getTicketHandler,
  listTicketsHandler,
  setLinksHandler,
  setPriorityHandler,
  setStatusHandler,
  supportCountsHandler,
} from "./support.handlers.server";
import { parseTicketInput, ticketRef } from "./support.input";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const dbRow = (i: number) => ({
  ticket_id: `t${i}`,
  ref: 1000 + i,
  subject: `Ticket ${i}`,
  channel: "viber",
  category: "pay",
  priority: "normal",
  status: "open",
  user_id: null,
  household_id: null,
  contact_id: null,
  contact: null,
  assignee_id: null,
  created_at: "2026-10-15T00:00:00Z",
  updated_at: "2026-10-15T00:00:00Z",
  resolved_at: null,
  note_count: 0,
});

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("ticket input (FR-SP-1, FR-SP-2, FR-SP-6)", () => {
  it("cleans a good ticket", () => {
    expect(
      parseTicketInput({
        subject: "  Payout missing ",
        body: " Ana says ",
        channel: "viber",
        category: "payout",
        priority: "high",
        contact: "  Ana R. ",
        userId: ID,
      }),
    ).toEqual({
      subject: "Payout missing",
      body: "Ana says",
      channel: "viber",
      category: "payout",
      priority: "high",
      contact: "Ana R.",
      userId: ID,
      householdId: null,
      contactId: null,
      assigneeId: null,
    });
  });

  it("refuses bad values", () => {
    const base = { subject: "x", body: "y", channel: "viber" as const, category: "pay" as const };
    for (const bad of [
      { subject: "" },
      { subject: "x".repeat(161) },
      { body: "" },
      { body: "x".repeat(5001) },
      { channel: "tiktok" },
      { category: "refunds" },
      { priority: "urgent" },
      { contact: "x".repeat(121) },
      { userId: "nope" },
    ]) {
      expect(() => parseTicketInput({ ...base, ...(bad as object) })).toThrow(ConsoleError);
    }
  });

  it("numbers read LIN-1042", () => {
    expect(ticketRef(1042)).toBe("LIN-1042");
  });
});

describe("reads (support.view)", () => {
  it("list checks support.view first and pages", async () => {
    m.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => dbRow(i)), error: null });
    const res = await listTicketsHandler({ page: 1, status: "active", assignee: "mine" });
    expect(m.requireStaff).toHaveBeenCalledWith("support.view");
    expect(m.rpc).toHaveBeenCalledWith("support_list_tickets", {
      p_search: null,
      p_status: "active",
      p_assignee: ME,
      p_category: null,
      p_priority: null,
      p_user_id: null,
      p_household_id: null,
      p_contact_id: null,
      p_limit: 51,
      p_offset: 50,
    });
    expect(res).toMatchObject({ ok: true, hasMore: true });
    if (res.ok) {
      expect(res.tickets).toHaveLength(50);
      expect(res.tickets[0]).toMatchObject({ ticketId: "t0", ref: 1000, noteCount: 0 });
    }
  });

  it("refuses unknown filters before querying", async () => {
    for (const bad of [
      { status: "done" },
      { assignee: "theirs" },
      { category: "refunds" },
      { userId: "nope" },
      { search: "x" },
    ]) {
      await expect(listTicketsHandler({ page: 0, ...(bad as object) })).resolves.toMatchObject({
        code: "invalid_input",
      });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("unassigned passes through", async () => {
    await listTicketsHandler({ page: 0, assignee: "unassigned", userId: ID });
    expect(m.rpc).toHaveBeenCalledWith(
      "support_list_tickets",
      expect.objectContaining({ p_assignee: "unassigned", p_user_id: ID }),
    );
  });

  it("detail and counts", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getTicketHandler({ ticketId: ID })).resolves.toMatchObject({ code: "not_found" });
    await expect(getTicketHandler({ ticketId: "x" })).resolves.toMatchObject({ code: "not_found" });
    m.rpc.mockResolvedValue({ data: { open: 3, pending: 1, unassigned: 2 }, error: null });
    await expect(supportCountsHandler()).resolves.toEqual({
      ok: true,
      counts: { open: 3, pending: 1, unassigned: 2 },
    });
  });
});

describe("writes (support.write, D37)", () => {
  it("create checks support.write and sends cleaned fields", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await expect(
      createTicketHandler({
        subject: "Help",
        body: "Details",
        channel: "phone",
        category: "other",
      }),
    ).resolves.toEqual({ ok: true, ticketId: ID });
    expect(m.requireStaff).toHaveBeenCalledWith("support.write");
    expect(m.rpc).toHaveBeenCalledWith("support_create_ticket", {
      p_actor: ME,
      p_subject: "Help",
      p_body: "Details",
      p_channel: "phone",
      p_category: "other",
      p_priority: "normal",
      p_contact: null,
      p_user_id: null,
      p_household_id: null,
      p_contact_id: null,
      p_assignee_id: null,
    });
  });

  it("status, assignee, priority, links and notes", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await setStatusHandler({ ticketId: ID, status: "resolved" });
    expect(m.rpc).toHaveBeenLastCalledWith("support_set_status", {
      p_actor: ME,
      p_ticket_id: ID,
      p_status: "resolved",
    });
    await assignHandler({ ticketId: ID, assigneeId: null });
    expect(m.rpc).toHaveBeenLastCalledWith("support_assign", {
      p_actor: ME,
      p_ticket_id: ID,
      p_assignee_id: null,
    });
    await setPriorityHandler({ ticketId: ID, priority: "high" });
    expect(m.rpc).toHaveBeenLastCalledWith("support_set_priority", {
      p_actor: ME,
      p_ticket_id: ID,
      p_priority: "high",
    });
    await setLinksHandler({ ticketId: ID, userId: ID, householdId: null, contactId: null });
    expect(m.rpc).toHaveBeenLastCalledWith("support_set_links", {
      p_actor: ME,
      p_ticket_id: ID,
      p_user_id: ID,
      p_household_id: null,
      p_contact_id: null,
    });
    m.rpc.mockResolvedValue({ data: "n1", error: null });
    await expect(addNoteHandler({ ticketId: ID, body: " Replied on Viber " })).resolves.toEqual({
      ok: true,
      id: "n1",
    });
    expect(m.rpc).toHaveBeenLastCalledWith("support_add_note", {
      p_actor: ME,
      p_ticket_id: ID,
      p_body: "Replied on Viber",
    });
  });

  it("bad values are refused before querying", async () => {
    await expect(
      setStatusHandler({ ticketId: ID, status: "done" as never }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    await expect(addNoteHandler({ ticketId: ID, body: " " })).resolves.toMatchObject({
      code: "invalid_input",
    });
    await expect(assignHandler({ ticketId: ID, assigneeId: "x" })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a rule break shows its message; other errors say nothing", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That ticket doesn't exist." },
    });
    await expect(setStatusHandler({ ticketId: ID, status: "open" })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That ticket doesn't exist.",
    });
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect(setStatusHandler({ ticketId: ID, status: "open" })).resolves.toMatchObject({
      code: "outside_service",
    });
  });
});

describe("in-app conversations", () => {
  it("accepts the billing category on a staff ticket, but not the in-app channel", () => {
    const t = parseTicketInput({
      subject: "Seats",
      body: "x",
      channel: "phone",
      category: "billing",
    });
    expect(t).toMatchObject({ channel: "phone", category: "billing" });
    expect(() =>
      parseTicketInput({ subject: "Seats", body: "x", channel: "in_app", category: "billing" }),
    ).toThrow("In-app tickets come from the household app. Pick where this message came from.");
  });

  it("staff can't log an in-app ticket: refused before the guard or the database", async () => {
    await expect(
      createTicketHandler({ subject: "Seats", body: "x", channel: "in_app", category: "other" }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" });
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps messages, unread counts and the last message time", async () => {
    m.rpc.mockResolvedValue({
      data: {
        ...dbRow(1),
        channel: "in_app",
        body: "b",
        created_by: ME,
        user_name: null,
        household_name: null,
        contact_name: null,
        notes: [],
        household_unread: 1,
        staff_unread: 2,
        last_message_at: "2026-10-15T02:00:00Z",
        messages: [
          {
            id: "g1",
            ticket_id: "t1",
            author_id: ME,
            from_staff: true,
            body: "hi",
            created_at: "2026-10-15T01:00:00Z",
          },
        ],
      },
      error: null,
    });
    const res = await getTicketHandler({ ticketId: ID });
    expect(res).toMatchObject({
      ok: true,
      ticket: {
        householdUnread: 1,
        staffUnread: 2,
        lastMessageAt: "2026-10-15T02:00:00Z",
        messages: [{ id: "g1", ticketId: "t1", authorId: ME, fromStaff: true, body: "hi" }],
      },
    });
  });

  it("a list row carries the channel and unread count", async () => {
    m.rpc.mockResolvedValue({
      data: [
        {
          ...dbRow(1),
          channel: "in_app",
          staff_unread: 4,
          last_message_at: "2026-10-15T02:00:00Z",
        },
      ],
      error: null,
    });
    const res = await listTicketsHandler({ page: 0 });
    expect(res).toMatchObject({
      tickets: [{ channel: "in_app", staffUnread: 4, lastMessageAt: "2026-10-15T02:00:00Z" }],
    });
  });

  it("replying needs support.write and sends the trimmed body", async () => {
    m.rpc.mockResolvedValue({ data: "g9", error: null });
    await expect(replyToTicketHandler({ ticketId: ID, body: "  Hello  " })).resolves.toEqual({
      ok: true,
      id: "g9",
    });
    expect(m.requireStaff).toHaveBeenCalledWith("support.write");
    expect(m.rpc).toHaveBeenCalledWith("support_reply", {
      p_actor: ME,
      p_ticket_id: ID,
      p_body: "Hello",
    });
  });

  it("refuses an empty, oversized or misaddressed reply before any I/O", async () => {
    for (const input of [
      { ticketId: ID, body: "   " },
      { ticketId: ID, body: "x".repeat(4001) },
      { ticketId: "nope", body: "hi" },
    ]) {
      await expect(replyToTicketHandler(input)).resolves.toMatchObject({ ok: false });
    }
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a refused reply (not an app ticket) comes back as a conflict", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Not from the app." } });
    await expect(replyToTicketHandler({ ticketId: ID, body: "hi" })).resolves.toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("marking read needs only support.view", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(markTicketReadHandler({ ticketId: ID })).resolves.toEqual({ ok: true });
    expect(m.requireStaff).toHaveBeenCalledWith("support.view");
    expect(m.rpc).toHaveBeenCalledWith("support_staff_mark_read", {
      p_actor: ME,
      p_ticket_id: ID,
    });
    await expect(markTicketReadHandler({ ticketId: "nope" })).resolves.toMatchObject({
      code: "not_found",
    });
  });
});
