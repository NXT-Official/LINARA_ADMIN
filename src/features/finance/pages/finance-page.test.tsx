// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asRole } from "@/features/auth/staff.test-utils";

const m = vi.hoisted(() => ({
  figures: vi.fn(),
  costs: vi.fn(),
  prices: vi.fn(),
  saveCost: vi.fn(),
  delCost: vi.fn(),
  savePrice: vi.fn(),
}));
vi.mock("../finance.actions", () => ({
  getFinanceFn: (...a: unknown[]) => m.figures(...a),
  listCostsFn: (...a: unknown[]) => m.costs(...a),
  listModelPricesFn: (...a: unknown[]) => m.prices(...a),
  saveCostFn: (...a: unknown[]) => m.saveCost(...a),
  deleteCostFn: (...a: unknown[]) => m.delCost(...a),
  saveModelPriceFn: (...a: unknown[]) => m.savePrice(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FinancePage } from "./finance-page";

const FINANCE = {
  revenueCentavos: 69700,
  cogsCentavos: 150000,
  costEntriesCentavos: 150000,
  aiCostCentavos: 0,
  aiCalls: 0,
  costPerCallCentavos: null,
  profitCentavos: -80300,
  payingHouseholds: 1,
  users: 0,
  profitPerUserCentavos: null,
  series: [
    {
      month: "2026-10",
      revenueCentavos: 69700,
      cogsCentavos: 150000,
      profitCentavos: -80300,
      aiCalls: 0,
    },
  ],
  aiByFn: [{ fn: "chat", calls: 3, costCentavos: 45, inputTokens: 1200, outputTokens: 800 }],
};
const COST = {
  id: "c1",
  month: "2026-10-01",
  category: "infra",
  label: "Server",
  amountCentavos: 150000,
  note: null,
};
const PRICE = {
  model: "gpt-4o",
  inputCentavosPer1m: 14000,
  outputCentavosPer1m: 56000,
  audioCentavosPerMinute: 0,
  note: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Role = asRole(["dashboard.view", "finance.view"]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Role>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Role>
  );
  return render(<FinancePage />, { wrapper });
}

beforeEach(() => {
  // recharts measures its container; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const f of Object.values(m)) f.mockReset();
  m.figures.mockResolvedValue({ ok: true, finance: FINANCE });
  m.costs.mockResolvedValue({ ok: true, costs: [COST] });
  m.prices.mockResolvedValue({ ok: true, prices: [PRICE] });
  m.saveCost.mockResolvedValue({ ok: true, costId: "c2" });
  m.delCost.mockResolvedValue({ ok: true });
  m.savePrice.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("Finance page", () => {
  it("shows the figures with definitions, pesos and dashes", async () => {
    renderPage();
    expect(await screen.findByText("₱697.00")).toBeInTheDocument();
    expect(screen.getByText("−₱803.00")).toBeInTheDocument();
    expect(screen.getByText("Revenue minus COGS.")).toBeInTheDocument();
    expect(
      screen.getByText("Covered by a paid plan at any point in the range (₱0 comps excluded)."),
    ).toBeInTheDocument();
    // Cost per AI call and profit per user have no divisor.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("mounts the chart surface and has no export button", async () => {
    renderPage();
    expect(await screen.findByText("Revenue, COGS and profit")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /revenue, cogs and profit by month/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv|export/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: /as a table/i });
    expect(within(table).getByText("₱697.00")).toBeInTheDocument();
    expect(within(table).getByText("−₱803.00")).toBeInTheDocument();
  });

  it("lists AI by function, costs and model prices", async () => {
    renderPage();
    expect((await screen.findAllByText("chat")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Server").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₱140.00").length).toBeGreaterThan(0);
  });

  it("one failing section does not blank the rest", async () => {
    m.figures.mockResolvedValue({ ok: false, code: "outside_service", message: "Down." });
    renderPage();
    expect((await screen.findAllByText("Finance figures didn't load")).length).toBeGreaterThan(0);
    expect(await screen.findAllByText("Server")).not.toHaveLength(0);
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
  });

  it("a costs failure leaves the figures showing", async () => {
    m.costs.mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByText("₱697.00")).toBeInTheDocument();
    expect(await screen.findByText("The costs didn't load")).toBeInTheDocument();
  });

  it("adding a cost calls the function with centavos and reloads", async () => {
    renderPage();
    await screen.findByText("₱697.00");
    await waitFor(() => expect(m.costs).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Add cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Domain" } });
    fireEvent.change(within(dialog).getByLabelText("Amount (pesos)"), {
      target: { value: "99.50" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add cost" }));
    await waitFor(() => expect(m.saveCost).toHaveBeenCalledTimes(1));
    expect(m.saveCost.mock.calls[0]?.[0].data).toMatchObject({
      label: "Domain",
      amountCentavos: 9950,
      category: "infra",
      note: null,
    });
    expect(m.saveCost.mock.calls[0]?.[0].data.month).toMatch(/^\d{4}-\d{2}-01$/);
    await waitFor(() => expect(m.costs.mock.calls.length).toBeGreaterThan(1));
    expect(m.figures.mock.calls.length).toBeGreaterThan(1);
  });

  it("refuses a bad amount without calling the function", async () => {
    renderPage();
    await screen.findByText("₱697.00");
    fireEvent.click(screen.getByRole("button", { name: "Add cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Domain" } });
    fireEvent.change(within(dialog).getByLabelText("Amount (pesos)"), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add cost" }));
    expect(
      await within(dialog).findByText("Use pesos with up to two decimals."),
    ).toBeInTheDocument();
    expect(m.saveCost).not.toHaveBeenCalled();
  });

  it("delete asks first, then calls the function", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete Server" }))[0]!);
    expect(m.delCost).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete cost" }));
    await waitFor(() => expect(m.delCost).toHaveBeenCalledTimes(1));
    expect(m.delCost.mock.calls[0]?.[0]).toEqual({ data: { id: "c1" } });
  });

  it("edits a model price in centavos", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit gpt-4o" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Input, pesos per 1M tokens"), {
      target: { value: "150.25" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(m.savePrice).toHaveBeenCalledTimes(1));
    expect(m.savePrice.mock.calls[0]?.[0].data).toMatchObject({
      model: "gpt-4o",
      inputCentavosPer1m: 15025,
      outputCentavosPer1m: 56000,
    });
  });

  it("an inverted custom range asks for the dates and does not query", async () => {
    renderPage();
    await screen.findByText("₱697.00");
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-01" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Start must be on or before");
    const calls = m.figures.mock.calls.length;
    expect(m.figures.mock.calls.at(-1)?.[0].data.from).not.toBe("2026-12-31");
    expect(m.figures.mock.calls.length).toBe(calls);
  });
});
