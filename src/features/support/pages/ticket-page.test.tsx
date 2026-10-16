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
  users: vi.fn(),
}));
vi.mock("../support.actions", () => ({
  getTicketFn: (...a: unknown[]) => m.get(...a),
  setStatusFn: (...a: unknown[]) => m.status(...a),
  assignFn: (...a: unknown[]) => m.assign(...a),
  setPriorityFn: (...a: unknown[]) => m.priority(...a),
  setLinksFn: (...a: unknown[]) => m.links(...a),
  addNoteFn: (...a: unknown[]) => m.note(...a),
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
  listAdminsFn: async () => ({
    ok: true,
    admins: [
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TicketPage } from "./ticket-page";

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
