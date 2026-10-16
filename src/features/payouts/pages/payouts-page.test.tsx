// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatPeso } from "@/lib/format";

import type { PayoutProblem } from "../payouts.types";

const m = vi.hoisted(() => ({ list: vi.fn(), reveal: vi.fn() }));
vi.mock("../payouts.actions", () => ({
  listPayoutProblemsFn: (...a: unknown[]) => m.list(...a),
}));
vi.mock("@/features/pay/pay.actions", () => ({
  revealPayoutAmountFn: (...a: unknown[]) => m.reveal(...a),
}));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/shared/links", () => ({
  RecordLink: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { PayoutsPage } from "./payouts-page";
import { asRole, SUPPORT } from "@/features/auth/staff.test-utils";

const AMOUNT = 4321.5;
const problem = (over: Partial<PayoutProblem> = {}): PayoutProblem => ({
  attemptId: "a1",
  payslipId: "p1",
  attemptNumber: 2,
  kind: "failed",
  failureReason: "Account closed",
  referenceId: "ref-123",
  channelCode: "PH_GCASH",
  helperId: "h1",
  helperName: "Nena",
  householdId: "hh1",
  householdName: "Reyes home",
  cutoffStart: "2026-10-01",
  cutoffEnd: "2026-10-15",
  createdAt: "2026-10-16T09:00:00Z",
  ...over,
});

function renderPage(initial = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PayoutsPage initial={initial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.list.mockReset().mockResolvedValue({ ok: true, hasMore: true, problems: [problem()] });
  m.reveal.mockReset().mockResolvedValue({ ok: true, amount: AMOUNT });
});
afterEach(cleanup);

describe("PayoutsPage (FR-PO-1 to FR-PO-3)", () => {
  it("shows problems from the server", async () => {
    renderPage();
    expect((await screen.findAllByText("Nena"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Failed")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Account closed")[0]).toBeInTheDocument();
    expect(screen.getAllByText("ref-123")[0]).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0 } });
  });

  it("helper and household link to the household page", async () => {
    renderPage();
    const links = await screen.findAllByRole("link", { name: "Reyes home" });
    expect(links[0]).toHaveAttribute("href", "/households/hh1");
  });

  it("kind filter goes to the server and resets the page", async () => {
    renderPage();
    await screen.findAllByText("Nena");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith({ data: { page: 1 } }));
    fireEvent.click(screen.getByRole("radio", { name: "Stuck sending" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 0, kind: "stuck" } }),
    );
  });

  it("a dashboard link starts with its filter", async () => {
    renderPage({ kind: "no_answer" });
    await waitFor(() =>
      expect(m.list).toHaveBeenCalledWith({ data: { page: 0, kind: "no_answer" } }),
    );
  });

  it("reason renders as text", async () => {
    m.list.mockResolvedValue({
      ok: true,
      hasMore: false,
      problems: [problem({ failureReason: "<img src=x onerror=alert(1)>" })],
    });
    const { container } = renderPage();
    expect((await screen.findAllByText("<img src=x onerror=alert(1)>"))[0]).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("amount is hidden until Show, then revealed from the server", async () => {
    renderPage();
    await screen.findAllByText("Nena");
    expect(screen.queryByText(formatPeso(AMOUNT))).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Show Nena's payout amount" })[0]);
    expect((await screen.findAllByText(formatPeso(AMOUNT)))[0]).toBeInTheDocument();
    expect(m.reveal).toHaveBeenCalledWith({ data: { attemptId: "a1" } });
  });

  it("an empty list says every recent payout went through", async () => {
    m.list.mockResolvedValue({ ok: true, hasMore: false, problems: [] });
    renderPage();
    expect(await screen.findByText("No payout problems")).toBeInTheDocument();
  });

  it("there is no Check at Xendit button", async () => {
    renderPage();
    await screen.findAllByText("Nena");
    expect(screen.queryByRole("button", { name: /xendit/i })).toBeNull();
    expect(screen.getByText(/search the reference in the Xendit dashboard/)).toBeInTheDocument();
  });
});

describe("permissions (FR-RL-8)", () => {
  it("no Show amount without pay.view", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PayoutsPage />
      </QueryClientProvider>,
      { wrapper: asRole(SUPPORT) },
    );
    await screen.findAllByText("Nena");
    expect(screen.queryByRole("button", { name: /payout amount/ })).toBeNull();
  });
});
