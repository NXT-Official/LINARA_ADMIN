// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRow } from "../users.types";

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../users.actions", () => ({ listUsersFn: (...a: unknown[]) => m.list(...a) }));
vi.mock("@/components/shared/links", () => ({
  RowLink: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));

import { UsersPage } from "./users-page";

const user = (over: Partial<UserRow> = {}): UserRow => ({
  userId: "u1",
  fullName: "Ana Reyes",
  email: "ana@example.com",
  kind: "primary_manager",
  householdId: "h1",
  householdName: "Reyes home",
  householdCount: 1,
  joinedAt: "2026-10-01T00:00:00Z",
  lastSignInAt: null,
  suspended: false,
  devices: 0,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

beforeEach(() =>
  m.list.mockReset().mockResolvedValue({ ok: true, users: [user()], hasMore: false }),
);
afterEach(cleanup);

describe("UsersPage (FR-US-1, FR-US-2)", () => {
  it("shows users from the server", async () => {
    renderPage();
    // DataTable renders the table and the stacked phone cards (NFR-3): each row twice.
    expect((await screen.findAllByRole("link", { name: "Ana Reyes" }))[0]).toHaveAttribute(
      "href",
      "/users/u1",
    );
    expect(screen.getAllByText("Reyes home")[0]).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0 } });
  });

  it("says when someone is in more than one household", async () => {
    m.list.mockResolvedValue({
      ok: true,
      hasMore: false,
      users: [user({ householdCount: 3, suspended: true })],
    });
    renderPage();
    expect((await screen.findAllByText("and 2 more"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Suspended")[0]).toBeInTheDocument();
  });

  it("search waits 300 ms and resets to page 1", async () => {
    m.list.mockResolvedValue({ ok: true, users: [user()], hasMore: true });
    renderPage();
    await screen.findAllByRole("link", { name: "Ana Reyes" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith({ data: { page: 1 } }));

    const box = screen.getByLabelText("Search name, email or phone");
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.change(box, { target: { value: "ana" } });
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 0, search: "ana" } }),
    );
    expect(m.list).not.toHaveBeenCalledWith({ data: { page: 1, search: "a" } });
    expect(m.list).not.toHaveBeenCalledWith({ data: { page: 0, search: "a" } });
  });

  it("filters by kind on the server", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Ana Reyes" });
    fireEvent.click(screen.getByRole("radio", { name: "Helpers" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 0, kind: "helper" } }),
    );
  });

  it("the Suspended filter goes to the server", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Ana Reyes" });
    fireEvent.click(screen.getByRole("radio", { name: "Suspended" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 0, suspended: true } }),
    );
  });

  it("empty search result says so", async () => {
    m.list.mockResolvedValue({ ok: true, users: [], hasMore: false });
    renderPage();
    expect(await screen.findByText("No users match")).toBeInTheDocument();
  });

  it("server error shows the message", async () => {
    m.list.mockResolvedValue({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
    renderPage();
    expect(await screen.findByText("The users didn't load")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong on our side. Try again.")).toBeInTheDocument();
  });
});
