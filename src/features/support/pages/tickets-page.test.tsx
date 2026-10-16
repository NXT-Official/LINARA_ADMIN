// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TicketRow } from "../support.types";

const m = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), navigate: vi.fn() }));
vi.mock("../support.actions", () => ({
  listTicketsFn: (...a: unknown[]) => m.list(...a),
  createTicketFn: (...a: unknown[]) => m.create(...a),
}));
vi.mock("@/features/team/team.actions", () => ({
  listAdminsFn: async () => ({
    ok: true,
    admins: [{ userId: "a1", email: "ops@example.com", isYou: true }],
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => m.navigate }));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/shared/links", () => ({
  RowLink: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { TicketsPage } from "./tickets-page";

const row = (over: Partial<TicketRow> = {}): TicketRow => ({
  ticketId: "t1",
  ref: 1042,
  subject: "Payout missing",
  channel: "viber",
  category: "payout",
  priority: "high",
  status: "open",
  userId: null,
  householdId: null,
  contactId: null,
  contact: "Ana R.",
  assigneeId: null,
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
  resolvedAt: null,
  noteCount: 2,
  ...over,
});

function renderPage(initial = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TicketsPage initial={initial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.list.mockReset().mockResolvedValue({ ok: true, hasMore: true, tickets: [row()] });
  m.create.mockReset().mockResolvedValue({ ok: true, ticketId: "t9" });
  m.navigate.mockReset();
});
afterEach(cleanup);

describe("TicketsPage (FR-SP-1 to FR-SP-6)", () => {
  it("shows tickets from the server", async () => {
    renderPage();
    // DataTable renders the table and the stacked phone cards (NFR-3): each row twice.
    expect((await screen.findAllByRole("link", { name: "Payout missing" }))[0]).toHaveAttribute(
      "href",
      "/support/t1",
    );
    expect(screen.getAllByText(/LIN-1042/)[0]).toBeInTheDocument();
    expect(screen.getAllByText("No one")[0]).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0, status: "active" } });
  });

  it("filters go to the server and reset the page", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Payout missing" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 1, status: "active" } }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mine" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({
        data: { page: 0, status: "resolved", assignee: "mine" },
      }),
    );
  });

  it("a dashboard link starts with its filter", async () => {
    renderPage({ assignee: "unassigned" });
    await waitFor(() =>
      expect(m.list).toHaveBeenCalledWith({
        data: { page: 0, status: "active", assignee: "unassigned" },
      }),
    );
  });

  it("logging a ticket posts it and opens it", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Payout missing" });
    fireEvent.click(screen.getByRole("button", { name: "Log ticket" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Subject"), {
      target: { value: "Can't add a helper" },
    });
    fireEvent.change(within(dialog).getByLabelText("What they need"), {
      target: { value: "The invite code fails" },
    });
    fireEvent.change(within(dialog).getByLabelText("Who they are on that channel"), {
      target: { value: "Ana R." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log ticket" }));
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        data: {
          subject: "Can't add a helper",
          body: "The invite code fails",
          channel: "messenger",
          category: "other",
          priority: "normal",
          contact: "Ana R.",
        },
      }),
    );
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith({ to: "/support/t9" }));
  });
});
