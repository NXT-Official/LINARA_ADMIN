// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardData } from "../dashboard.types";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../dashboard.actions", () => ({ getDashboardFn: (...a: unknown[]) => m.get(...a) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/shared/charts", () => ({
  ChartSurface: ({ title, data }: { title: string; data: { key: string; value: number }[] }) => (
    <section aria-label={title}>{data.map((d) => `${d.key}:${d.value}`).join(" ")}</section>
  ),
  TrendChart: () => null,
  ColumnChart: () => null,
}));

import { DashboardPage } from "./dashboard-page";

const data: DashboardData = {
  households: 12,
  householdsNew7d: 1,
  householdsNew30d: 3,
  householdsActive7d: 5,
  managers: 9,
  managersMultiHome: 2,
  helpersActive: 6,
  helpersInvited: 1,
  helpersEnded: 2,
  newHouseholdsWeekly: [{ weekStart: "2026-10-12", count: 1 }],
  tasksDoneDaily: [{ day: "2026-10-15", count: 4 }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => m.get.mockReset().mockResolvedValue({ ok: true, data }));
afterEach(cleanup);

describe("DashboardPage (FR-DB-1 to FR-DB-3, FR-DB-8, FR-DB-9)", () => {
  it("shows real numbers, each linking to its list", async () => {
    renderPage();
    const households = await screen.findByRole("link", { name: /^Households/ });
    expect(households).toHaveAttribute("href", "/households");
    expect(households).toHaveTextContent("12");
    expect(households).toHaveTextContent("1 new this week, 3 this month");
    expect(screen.getByRole("link", { name: /Active in the last 7 days/ })).toHaveTextContent("5");
    expect(screen.getByRole("link", { name: /^Managers/ })).toHaveAttribute("href", "/users");
    expect(screen.getByRole("link", { name: /Helpers working/ })).toHaveTextContent(
      "1 invited, 2 ended",
    );
  });

  it("charts get the server's series", async () => {
    renderPage();
    expect(await screen.findByLabelText("Tasks done")).toHaveTextContent("2026-10-15:4");
    expect(screen.getByLabelText("New households")).toHaveTextContent("2026-10-12:1");
  });

  it("later modules say they're unavailable and when they arrive, never zero", async () => {
    renderPage();
    await screen.findByRole("link", { name: /^Households/ });
    for (const text of [
      "CRM: arrives in Phase 3",
      "Deletion requests: arrive in Phase 4",
      "Support tickets: arrive in Phase 5",
      "Payouts and AI usage: arrive in Phase 6",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("a failed load shows Unavailable with the reason", async () => {
    m.get.mockResolvedValue({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
    renderPage();
    expect(await screen.findByText("The dashboard didn't load")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong on our side. Try again.")).toBeInTheDocument();
  });
});
