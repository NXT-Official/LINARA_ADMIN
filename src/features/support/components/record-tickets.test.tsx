// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../support.actions", () => ({
  listTicketsFn: (...a: unknown[]) => m.list(...a),
  createTicketFn: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/shared/links", () => ({
  RecordLink: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { RecordTickets } from "./record-tickets";

function renderPanel(filter: { userId?: string; householdId?: string; contactId?: string }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordTickets filter={filter} />
    </QueryClientProvider>,
  );
}

beforeEach(() => m.list.mockReset());
afterEach(cleanup);

describe("RecordTickets (FR-US-3, FR-HH-2, FR-CRM-12)", () => {
  it("lists the record's tickets, newest activity first, with links", async () => {
    m.list.mockResolvedValue({
      ok: true,
      hasMore: false,
      tickets: [
        {
          ticketId: "t1",
          ref: 1042,
          subject: "Payout missing",
          status: "pending",
          priority: "high",
          channel: "viber",
          category: "payout",
          updatedAt: "2026-10-15T00:00:00Z",
        },
      ],
    });
    renderPanel({ userId: "u1" });
    expect(await screen.findByRole("link", { name: "LIN-1042 Payout missing" })).toHaveAttribute(
      "href",
      "/support/t1",
    );
    expect(screen.getByText("Waiting on user")).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0, userId: "u1" } });
    expect(screen.getByRole("button", { name: "Log ticket" })).toBeInTheDocument();
  });

  it("says when there are none", async () => {
    m.list.mockResolvedValue({ ok: true, hasMore: false, tickets: [] });
    renderPanel({ householdId: "h1" });
    await waitFor(() => expect(screen.getByText("No tickets.")).toBeInTheDocument());
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0, householdId: "h1" } });
  });
});
