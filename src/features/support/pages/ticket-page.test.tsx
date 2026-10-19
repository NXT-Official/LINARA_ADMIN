// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TicketDetail } from "../support.types";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  status: vi.fn(),
  assign: vi.fn(),
  priority: vi.fn(),
  links: vi.fn(),
  note: vi.fn(),
  reply: vi.fn(),
  read: vi.fn(),
  users: vi.fn(),
}));
vi.mock("../support.actions", () => ({
  getTicketFn: (...a: unknown[]) => m.get(...a),
  setStatusFn: (...a: unknown[]) => m.status(...a),
  assignFn: (...a: unknown[]) => m.assign(...a),
  setPriorityFn: (...a: unknown[]) => m.priority(...a),
  setLinksFn: (...a: unknown[]) => m.links(...a),
  addNoteFn: (...a: unknown[]) => m.note(...a),
  replyToTicketFn: (...a: unknown[]) => m.reply(...a),
  markTicketReadFn: (...a: unknown[]) => m.read(...a),
}));
vi.mock("@/features/users/users.actions", () => ({
  listUsersFn: (...a: unknown[]) => m.users(...a),
}));
vi.mock("@/features/households/households.actions", () => ({
  listHouseholdsFn: async () => ({ ok: true, hasMore: false, households: [] }),
}));
vi.mock("@/features/crm/crm.actions", () => ({
  listContactsFn: async () => ({ ok: true, hasMore: false, contacts: [] }),
}));
vi.mock("@/features/team/team.actions", () => ({
  listTeamNamesFn: async () => ({
    ok: true,
    members: [
      { userId: "a1", email: "ops@example.com", isYou: true },
      { userId: "a2", email: "sales@example.com", isYou: false },
    ],
  }),
}));
vi.mock("@/features/audit/components/audit-trail", () => ({
  AuditTrail: ({ targetId }: { targetId: string }) => <p>History for {targetId}</p>,
}));
vi.mock("@/components/shared/links", () => {
  const A = ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>;
  return { RowLink: A, RecordLink: A, BackLink: A };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { TicketPage } from "./ticket-page";
import { asRole } from "@/features/auth/staff.test-utils";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const ticket: TicketDetail = {
  ticketId: ID,
  ref: 1042,
  subject: "Can't add <img src=x onerror=alert(1)>",
  body: "The invite code fails\nevery time",
  channel: "viber",
  category: "account",
  priority: "normal",
  status: "closed",
  userId: "u1",
  householdId: null,
  contactId: null,
  contact: "Ana R.",
  assigneeId: null,
  createdBy: "a1",
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
  resolvedAt: "2026-10-15T01:00:00Z",
  userName: "Ana Reyes",
  householdName: null,
  contactName: null,
  notes: [
    { id: "n1", authorId: "a2", body: "Replied on Viber", createdAt: "2026-10-15T00:30:00Z" },
  ],
  messages: [],
  householdUnread: 0,
  staffUnread: 0,
  lastMessageAt: null,
};
const inApp: TicketDetail = {
  ...ticket,
  channel: "in_app",
  status: "open",
  staffUnread: 2,
  lastMessageAt: "2026-10-15T02:00:00Z",
  messages: [
    {
      id: "g1",
      ticketId: ID,
      authorId: "u1",
      fromStaff: false,
      body: "Where is my invite?",
      createdAt: "2026-10-15T01:00:00Z",
    },
    {
      id: "g2",
      ticketId: ID,
      authorId: "a2",
      fromStaff: true,
      body: "Sent it just now",
      createdAt: "2026-10-15T01:30:00Z",
    },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TicketPage ticketId={ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.get.mockResolvedValue({ ok: true, ticket });
  for (const f of [m.status, m.assign, m.priority, m.links]) f.mockResolvedValue({ ok: true });
  m.note.mockResolvedValue({ ok: true, id: "n2" });
  m.reply.mockResolvedValue({ ok: true, id: "g3" });
  m.read.mockResolvedValue({ ok: true });
  toast.success.mockReset();
  toast.error.mockReset();
  m.users.mockResolvedValue({
    ok: true,
    hasMore: false,
    users: [{ userId: "u7", fullName: "Lia Santos", email: "lia@example.com", kind: "co_manager" }],
  });
});
afterEach(cleanup);

describe("TicketPage (FR-SP-3 to FR-SP-7)", () => {
  it("subject renders as text", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Can't add <img src=x onerror=alert(1)>" }),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/LIN-1042/)).toBeInTheDocument();
    expect(screen.getByText(/every time/)).toBeInTheDocument();
  });

  it("status moves and a closed ticket can be reopened", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Can't add/ });
    fireEvent.click(screen.getByRole("radio", { name: "Open" }));
    await waitFor(() =>
      expect(m.status).toHaveBeenCalledWith({ data: { ticketId: ID, status: "open" } }),
    );
  });

  it("assign to me, to another admin, or no one", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Can't add/ });
    fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
    await waitFor(() =>
      expect(m.assign).toHaveBeenLastCalledWith({ data: { ticketId: ID, assigneeId: "a1" } }),
    );
    fireEvent.change(screen.getByLabelText("Assigned to"), { target: { value: "a2" } });
    await waitFor(() =>
      expect(m.assign).toHaveBeenLastCalledWith({ data: { ticketId: ID, assigneeId: "a2" } }),
    );
    fireEvent.change(screen.getByLabelText("Assigned to"), { target: { value: "" } });
    await waitFor(() =>
      expect(m.assign).toHaveBeenLastCalledWith({ data: { ticketId: ID, assigneeId: null } }),
    );
  });

  it("priority changes on one tap", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Can't add/ });
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    await waitFor(() =>
      expect(m.priority).toHaveBeenCalledWith({ data: { ticketId: ID, priority: "high" } }),
    );
  });

  it("adding a note is two taps", async () => {
    renderPage();
    expect(await screen.findByText("Replied on Viber")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "Called her back, fixed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() =>
      expect(m.note).toHaveBeenCalledWith({
        data: { ticketId: ID, body: "Called her back, fixed" },
      }),
    );
  });

  it("links show and can be changed", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Ana Reyes" })).toHaveAttribute(
      "href",
      "/users/u1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Change links" }));
    const dialog = await screen.findByRole("dialog");
    // Already linked to Ana: replace her.
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    fireEvent.change(within(dialog).getByLabelText("Find a user"), { target: { value: "lia" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Lia Santos" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save links" }));
    await waitFor(() =>
      expect(m.links).toHaveBeenCalledWith({
        data: { ticketId: ID, userId: "u7", householdId: null, contactId: null },
      }),
    );
  });

  it("a cancelled links change is forgotten", async () => {
    renderPage();
    await screen.findByRole("link", { name: "Ana Reyes" });
    fireEvent.click(screen.getByRole("button", { name: "Change links" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Change links" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save links" }));
    await waitFor(() =>
      expect(m.links).toHaveBeenCalledWith({
        data: { ticketId: ID, userId: "u1", householdId: null, contactId: null },
      }),
    );
  });

  it("long unbroken text wraps instead of widening the page", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", { level: 1, name: /Can't add/ });
    expect(heading.className).toMatch(/break-words|overflow-wrap/);
    expect(screen.getByText(/every time/).className).toMatch(/break-words|overflow-wrap/);
    expect(screen.getByText("Replied on Viber").className).toMatch(/break-words|overflow-wrap/);
  });

  it("history in the console", async () => {
    renderPage();
    expect(await screen.findByText(`History for ${ID}`)).toBeInTheDocument();
  });

  it("an unknown ticket shows Ticket not found", async () => {
    m.get.mockResolvedValue({ ok: false, code: "not_found", message: "x" });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Ticket not found" })).toBeInTheDocument();
  });
});

describe("Conversation (in-app tickets)", () => {
  it("shows household messages on the left and staff on the right, above the notes", async () => {
    m.get.mockResolvedValue({ ok: true, ticket: inApp });
    renderPage();
    const mine = await screen.findByText("Where is my invite?");
    expect(mine.closest("li")).toHaveAttribute("data-side", "household");
    expect(screen.getByText("Sent it just now").closest("li")).toHaveAttribute(
      "data-side",
      "staff",
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Conversation")).toBeLessThan(headings.indexOf("Notes"));
    expect(screen.getByText(/Replies in Conversation are sent to the household/)).toBeVisible();
    expect(screen.getByText(/The user never sees these/)).toBeVisible();
  });

  it("disables the form while sending, then clears it and toasts", async () => {
    m.get.mockResolvedValue({ ok: true, ticket: inApp });
    let settle: (v: unknown) => void = () => undefined;
    m.reply.mockReturnValue(new Promise((r) => (settle = r)));
    renderPage();
    const box = await screen.findByLabelText("Reply to the household");
    fireEvent.change(box, { target: { value: "On it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(m.reply).toHaveBeenCalledWith({ data: { ticketId: ID, body: "On it" } }),
    );
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sending" })).toBeDisabled();
    settle({ ok: true, id: "g3" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reply sent"));
    await waitFor(() => expect(screen.getByLabelText("Reply to the household")).toHaveValue(""));
    expect(screen.getByLabelText("Reply to the household")).toBeEnabled();
  });

  it("says the household opened an in-app ticket, not a former team member", async () => {
    m.get.mockResolvedValue({ ok: true, ticket: { ...inApp, createdBy: "u1" } });
    renderPage();
    await screen.findByText("Where is my invite?");
    // The creator is the household's manager: no "Logged by: Former member" row.
    const row = screen.getByText("Opened by").parentElement!;
    expect(row).toHaveTextContent("The household");
    expect(row).not.toHaveTextContent("Former member");
    expect(screen.queryByText("Logged by")).toBeNull();
  });

  it("names who logged a ticket from another channel", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Can't add/ });
    expect(screen.getByText("Logged by")).toBeInTheDocument();
    expect(screen.queryByText("Opened by")).toBeNull();
  });

  it("marks the household's messages read once while they are unread", async () => {
    m.get.mockResolvedValue({ ok: true, ticket: inApp });
    renderPage();
    await screen.findByText("Where is my invite?");
    await waitFor(() => expect(m.read).toHaveBeenCalledWith({ data: { ticketId: ID } }));
    expect(m.read).toHaveBeenCalledTimes(1);
  });

  it("is hidden for tickets that did not come from the app", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Can't add/ });
    expect(screen.queryByRole("heading", { name: "Conversation" })).toBeNull();
    expect(screen.queryByLabelText("Reply to the household")).toBeNull();
    expect(screen.queryByText(/Replies in Conversation/)).toBeNull();
    expect(m.read).not.toHaveBeenCalled();
  });

  it("a view-only role reads the conversation but can't reply", async () => {
    m.get.mockResolvedValue({ ok: true, ticket: inApp });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TicketPage ticketId={ID} />
      </QueryClientProvider>,
      { wrapper: asRole(["dashboard.view", "support.view"]) },
    );
    await screen.findByText("Where is my invite?");
    expect(screen.queryByRole("button", { name: "Send reply" })).toBeNull();
  });
});

describe("permissions (FR-RL-8)", () => {
  it("a view-only role sees the ticket but can't change it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TicketPage ticketId={ID} />
      </QueryClientProvider>,
      { wrapper: asRole(["dashboard.view", "support.view"]) },
    );
    await screen.findByRole("heading", { name: /Can't add/ });
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change links" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Resolved" })).toBeNull();
  });
});
