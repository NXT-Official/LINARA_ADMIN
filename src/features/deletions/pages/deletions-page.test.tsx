// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeletionRow } from "../deletions.types";

const m = vi.hoisted(() => ({ list: vi.fn(), process: vi.fn() }));
vi.mock("../deletions.actions", () => ({
  listDeletionsFn: (...a: unknown[]) => m.list(...a),
  processDeletionFn: (...a: unknown[]) => m.process(...a),
}));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/shared/links", () => {
  const A = ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>;
  return { RowLink: A, RecordLink: A, BackLink: A };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

// input-otp measures itself and looks for password managers; jsdom has neither API.
document.elementFromPoint ??= () => null;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { DeletionsPage } from "./deletions-page";

const row = (over: Partial<DeletionRow> = {}): DeletionRow => ({
  requestId: "r1",
  userId: "u1",
  fullName: "Mona Reyes",
  userType: "primary_manager",
  status: "pending",
  requestedAt: "2026-09-20T00:00:00Z",
  dueAt: "2026-10-20T00:00:00Z",
  daysLeft: 5,
  processedAt: null,
  blockers: [],
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeletionsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.list.mockReset().mockImplementation(async ({ data }: { data: { view: string } }) => ({
    ok: true,
    hasMore: false,
    requests:
      data.view === "pending"
        ? [
            row(),
            row({ requestId: "r2", userId: "u2", fullName: null, daysLeft: -3 }),
            row({
              requestId: "r3",
              userId: "u3",
              fullName: "Hana Helper",
              userType: "helper",
              blockers: ["active_employment"],
            }),
          ]
        : [
            row({
              requestId: "r8",
              status: "done",
              fullName: null,
              processedAt: "2026-10-01T00:00:00Z",
            }),
            row({ requestId: "r9", status: "cancelled", fullName: "Lou Tan" }),
          ],
  }));
  m.process.mockReset().mockResolvedValue({ ok: true, result: {} });
});
afterEach(cleanup);

// DataTable renders the table and the stacked phone cards (NFR-3): each row twice.
const tableRow = (name: string) =>
  screen.getAllByText(name)[0].closest("tr") as HTMLTableRowElement;

describe("DeletionsPage (FR-DL-1 to FR-DL-4, FR-DL-7)", () => {
  it("pending requests show days left and overdue stands out", async () => {
    renderPage();
    expect((await screen.findAllByText("5 days"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("3 days overdue")[0]).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { view: "pending", page: 0 } });
  });

  it("rows link to the user while the account exists", async () => {
    renderPage();
    expect((await screen.findAllByRole("link", { name: "Mona Reyes" }))[0]).toHaveAttribute(
      "href",
      "/users/u1",
    );
    expect(screen.getAllByText("Account already gone")[0]).toBeInTheDocument();
  });

  it("blockers show before the code", async () => {
    renderPage();
    await screen.findAllByText("Hana Helper");
    const blocked = tableRow("Hana Helper");
    expect(within(blocked).getByText(/Still employed/)).toBeInTheDocument();
    expect(within(blocked).queryByRole("button", { name: /Process/ })).toBeNull();
    expect(
      within(tableRow("Mona Reyes")).getByRole("button", { name: "Process Mona Reyes's request" }),
    ).toBeInTheDocument();
  });

  it("processing asks for the code and lists what is deleted and kept", async () => {
    renderPage();
    await screen.findAllByText("Mona Reyes");
    fireEvent.click(
      within(tableRow("Mona Reyes")).getByRole("button", { name: "Process Mona Reyes's request" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Deleted")).toBeInTheDocument();
    expect(within(dialog).getByText("Kept")).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Delete account" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(m.process).toHaveBeenCalledWith({ data: { requestId: "r1", code: "123456" } }),
    );
  });

  it("the main app's refusal is shown in the dialog", async () => {
    m.process.mockResolvedValue({
      ok: false,
      code: "conflict",
      message:
        "A household they're the last manager of still employs someone. End each employment (with final pay) first.",
    });
    renderPage();
    await screen.findAllByText("Mona Reyes");
    fireEvent.click(
      within(tableRow("Mona Reyes")).getByRole("button", { name: "Process Mona Reyes's request" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("still employs someone");
  });

  it("a console admin's request says why it can't be processed here", async () => {
    m.list.mockResolvedValue({
      ok: true,
      hasMore: false,
      requests: [row({ requestId: "r7", fullName: null, blockers: ["console_admin"] })],
    });
    renderPage();
    expect((await screen.findAllByText(/console admin's account/))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Console admin")[0]).toBeInTheDocument();
    expect(screen.queryByText("Account already gone")).toBeNull();
    expect(screen.queryByRole("button", { name: /Process/ })).toBeNull();
  });

  it("after processing, LINARA's result is shown (FR-DL-4)", async () => {
    m.process.mockResolvedValue({
      ok: true,
      result: {
        user_id: "u1",
        household_deleted: true,
        households_deleted: ["h1"],
        households_cleared: ["h1"],
        private_notes_deleted: 0,
      },
    });
    renderPage();
    await screen.findAllByText("Mona Reyes");
    fireEvent.click(
      within(tableRow("Mona Reyes")).getByRole("button", { name: "Process Mona Reyes's request" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Deleted Mona Reyes's account. 1 household they were the last manager of was deleted with it.",
    );
  });

  it("history tab lists finished and withdrawn", async () => {
    renderPage();
    await screen.findAllByText("Mona Reyes");
    fireEvent.click(screen.getByRole("radio", { name: "History" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { view: "history", page: 0 } }),
    );
    expect((await screen.findAllByText("Deleted"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Withdrawn")[0]).toBeInTheDocument();
  });
});
