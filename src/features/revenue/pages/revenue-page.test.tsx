// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffContext, type SessionStaff } from "@/features/auth/use-can";

import { manilaDate, periodRange } from "../revenue.logic";
import type { RevenueReport } from "../revenue.types";

// Only the server is mocked: the page, its rules and the query cache are real.
const server = vi.hoisted(() => ({ loadRevenueFn: vi.fn(), revenueActionFn: vi.fn() }));
vi.mock("../revenue.actions", () => server);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// jsdom has no layout, so Recharts' container is stubbed to a fixed size.
vi.mock("recharts", async (orig) => {
  const real = await orig<typeof import("recharts")>();
  return {
    ...real,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  };
});

import { RevenuePage } from "./revenue-page";

const REPORT: RevenueReport = {
  from: "2026-10-01",
  to: "2026-10-28",
  totals: {
    cash: 29_900,
    fees: 1_758,
    ai: 505,
    fixed: 31_000,
    profit: -3_363,
    payments: 2,
    planCash: 19_900,
    addonCash: 10_000,
  },
  months: [
    {
      month: "2026-10",
      cash: 29_900,
      fees: 1_758,
      ai: 505,
      fixed: 31_000,
      profit: -3_363,
      newMrr: 19_900,
      expansion: 0,
      contraction: 0,
      churn: 39_900,
    },
  ],
  review: { count: 1, amount: 39_900 },
  mrr: {
    now: 19_900,
    arr: 238_800,
    paying: 1,
    arppu: 19_900,
    pastDue: 0,
    pastDueMrr: 0,
    ending: 0,
    endingMrr: 0,
    trials: 0,
  },
  movements: {
    new: 59_800,
    newCount: 2,
    expansion: 0,
    contraction: 0,
    cancelled: 1,
    kept: 0,
    recovered: 0,
    recoveredMrr: 0,
    churn: 39_900,
    churned: 1,
    lapsed: 0,
  },
  mix: [{ planId: "normal", name: "Normal", cycle: "monthly", count: 1, mrr: 19_900 }],
  free: 2,
  addons: [
    { addonId: "extra_household", name: "Extra household", managers: 0, quantity: 0, mrr: 0 },
  ],
  aiUsage: [{ fn: "generate-sop", calls: 10, perCall: 50.5, cost: 505 }],
  settings: {
    feeRates: [{ channel: "GCASH", percent: 2.3, flat: 0 }],
    aiRates: [{ fn: "generate-sop", perCall: 50.5 }],
    costs: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Supabase Pro",
        monthly: 31_000,
        startsOn: "2026-10-01",
        endsOn: null,
      },
    ],
  },
};

const staff = (permissions: string[]): SessionStaff => ({
  userId: "u",
  email: "a@example.com",
  roleName: "Admin",
  preset: "admin",
  permissions,
});

function show(as?: SessionStaff) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {as ? (
        <StaffContext.Provider value={as}>
          <RevenuePage />
        </StaffContext.Provider>
      ) : (
        <RevenuePage />
      )}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.loadRevenueFn.mockResolvedValue(REPORT);
  server.revenueActionFn.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  for (const f of [server.loadRevenueFn, server.revenueActionFn, toast.success, toast.error])
    f.mockReset();
});

describe("the Revenue screen", () => {
  it("shows its shape while loading, then the figures, with estimates said to be estimates", async () => {
    let answer: (v: unknown) => void = () => {};
    server.loadRevenueFn.mockReturnValue(new Promise((r) => (answer = r)));
    show();
    expect(screen.getByText("Loading revenue")).toBeInTheDocument();
    await act(async () => answer(REPORT));
    const profit = within(
      (await screen.findByRole("heading", { name: "Profit" })).closest("section") as HTMLElement,
    );
    expect(profit.getByText("₱299")).toBeInTheDocument();
    expect(screen.getByText("-₱33.63")).toBeInTheDocument();
    expect(screen.getByText("Estimate, from the fee rates")).toBeInTheDocument();
    expect(screen.getByText("Estimate, from the cost per call")).toBeInTheDocument();
    expect(screen.getByText(/₱399 in 1 payment kept for review isn't counted/)).toBeInTheDocument();
    expect(screen.getByText("1 paying of 3 managers (33%)")).toBeInTheDocument();
  });

  it("asks for this month first, then the period picked", async () => {
    show();
    await waitFor(() =>
      expect(server.loadRevenueFn).toHaveBeenCalledWith({ data: periodRange("this_month") }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Last month/ }));
    await waitFor(() =>
      expect(server.loadRevenueFn).toHaveBeenCalledWith({ data: periodRange("last_month") }),
    );
  });

  it("a failed read says so, with the server's reason", async () => {
    server.loadRevenueFn.mockResolvedValue({
      ok: false,
      code: "not_allowed",
      message: "You can't see revenue.",
    });
    show();
    expect(await screen.findByText("Revenue didn't load")).toBeInTheDocument();
    expect(screen.getByText("You can't see revenue.")).toBeInTheDocument();
  });

  it("someone with revenue.view only sees the costs but can't change them", async () => {
    show(staff(["revenue.view"]));
    await screen.findByText("Xendit fee rates");
    expect(screen.queryByRole("button", { name: "Save rate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add cost" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /End Supabase Pro/ })).not.toBeInTheDocument();
    expect(screen.getByText("Set by an admin")).toBeInTheDocument();
  });
});

describe("costs, for revenue.manage", () => {
  it("adds a fixed cost in pesos, then reads the report again", async () => {
    show(staff(["revenue.view", "revenue.manage"]));
    await screen.findByText("Fixed monthly costs");
    fireEvent.change(screen.getByLabelText("Cost name"), { target: { value: "Vercel Pro" } });
    fireEvent.change(screen.getByLabelText("Monthly amount in pesos"), {
      target: { value: "1,250.50" },
    });
    const before = server.loadRevenueFn.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add cost" }));
    });
    expect(server.revenueActionFn).toHaveBeenCalledWith({
      data: {
        type: "add_cost",
        name: "Vercel Pro",
        monthly: 125_050,
        startsOn: manilaDate(new Date()),
      },
    });
    await waitFor(() => expect(server.loadRevenueFn.mock.calls.length).toBeGreaterThan(before));
  });

  it("a cost without an amount isn't sent", async () => {
    show(staff(["revenue.view", "revenue.manage"]));
    await screen.findByText("Fixed monthly costs");
    fireEvent.change(screen.getByLabelText("Cost name"), { target: { value: "Domain" } });
    fireEvent.change(screen.getByLabelText("Monthly amount in pesos"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add cost" }));
    expect(server.revenueActionFn).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("an AI cost per call is typed in pesos and sent in centavos", async () => {
    show(staff(["revenue.view", "revenue.manage"]));
    const input = await screen.findByLabelText("Cost per call for generate-sop, in pesos");
    fireEvent.change(input, { target: { value: "0.0525" } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
    expect(server.revenueActionFn).toHaveBeenCalledWith({
      data: { type: "set_ai_rate", fn: "generate-sop", perCall: 5.25 },
    });
  });

  it("a fee rate goes in upper case", async () => {
    show(staff(["revenue.view", "revenue.manage"]));
    await screen.findByText("Xendit fee rates");
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "credit_card" } });
    fireEvent.change(screen.getByLabelText("Percent"), { target: { value: "3.2" } });
    fireEvent.change(screen.getByLabelText("Flat fee in pesos"), { target: { value: "10" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    });
    expect(server.revenueActionFn).toHaveBeenCalledWith({
      data: { type: "set_fee_rate", channel: "CREDIT_CARD", percent: 3.2, flat: 1_000 },
    });
  });

  it("ending a cost ends it today; a refusal is shown in the server's words", async () => {
    server.revenueActionFn.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "That cost isn't running then.",
    });
    show(staff(["revenue.view", "revenue.manage"]));
    const end = await screen.findByRole("button", { name: "End Supabase Pro today" });
    await act(async () => {
      fireEvent.click(end);
    });
    expect(server.revenueActionFn).toHaveBeenCalledWith({
      data: { type: "end_cost", id: REPORT.settings.costs[0].id, endsOn: manilaDate(new Date()) },
    });
    expect(toast.error).toHaveBeenCalledWith("That cost isn't running then.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
