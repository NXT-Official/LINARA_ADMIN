// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiUsage } from "../ai.types";

const m = vi.hoisted(() => ({ usage: vi.fn(), exports: [] as string[] }));
vi.mock("../ai.actions", () => ({ aiUsageFn: (...a: unknown[]) => m.usage(...a) }));
vi.mock("@/components/shared/export-button", () => ({
  ExportCsvButton: ({ slug }: { slug: string }) => {
    m.exports.push(slug);
    return null;
  },
}));
vi.mock("@/components/shared/links", () => ({
  RecordLink: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/components/shared/charts", () => ({
  ChartSurface: ({
    title,
    data,
    labelHeader,
  }: {
    title: string;
    data: { key: string; value: number }[];
    labelHeader: string;
  }) => (
    <section aria-label={title} data-table-header={labelHeader}>
      {data.map((d) => `${d.key}=${d.value}`).join(" ")}
    </section>
  ),
  ColumnChart: () => null,
}));

import { AiUsagePage } from "./ai-usage-page";

const NOW = new Date("2026-10-16T12:30:00Z");
const usage: AiUsage = {
  hourly: [
    { fn: "route-utos", hour: "2026-10-16T11:00:00+00:00", calls: 4 },
    { fn: "generate-sop", hour: "2026-10-16T11:00:00+00:00", calls: 3 },
    { fn: "route-utos", hour: "2026-10-16T09:00:00+00:00", calls: 2 },
    { fn: "new-thing", hour: "2026-10-16T10:00:00+00:00", calls: 1 },
    // Over 24 hours ago: in the export, not in the chart or the totals.
    { fn: "route-utos", hour: "2026-10-15T08:00:00+00:00", calls: 50 },
  ],
  topUsers: [
    { userId: "u1", name: "Ana Reyes", calls: 9 },
    { userId: "u2", name: null, calls: 1 },
  ],
  limitHits: [
    {
      userId: "u1",
      name: "Ana Reyes",
      kind: "hourly",
      fn: "route-utos",
      at: "2026-10-16T11:40:00Z",
    },
    { userId: "u3", name: null, kind: "daily", fn: null, at: "2026-10-16T08:00:00Z" },
  ],
  calls24h: 10,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AiUsagePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.usage.mockReset().mockResolvedValue({ ok: true, usage });
  m.exports = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AiUsagePage (FR-AI-1, FR-AI-2)", () => {
  it("header states 48 hours and no cost", async () => {
    renderPage();
    expect(await screen.findByText(/48 hours/)).toHaveTextContent(/Cost isn't recorded/);
  });

  it("per-hour chart totals all features over 24 hours, with a table view", async () => {
    renderPage();
    const chart = await screen.findByLabelText("Calls per hour");
    expect(chart).toHaveAttribute("data-table-header", "hour_start");
    expect(chart).toHaveTextContent("2026-10-16T11:00:00.000Z=7");
    expect(chart).toHaveTextContent("2026-10-16T09:00:00.000Z=2");
    expect(chart).toHaveTextContent("2026-10-15T13:00:00.000Z=0");
    expect(chart.textContent).not.toContain("2026-10-15T08:00");
    expect(chart.textContent?.split(" ")).toHaveLength(24);
  });

  it("features use their labels, unknown ones as stored", async () => {
    renderPage();
    expect(await screen.findByText("Quick Utos")).toBeInTheDocument();
    expect(screen.getByText("Routine writer")).toBeInTheDocument();
    expect(screen.getByText("new-thing")).toBeInTheDocument();
    expect(screen.getByText("Last 24 hours, 10 calls")).toBeInTheDocument();
  });

  it("the 24-hour total matches the bars", async () => {
    // The server's rolling 24 hours also counts 12:30 to 13:00 yesterday, which no bar shows.
    m.usage.mockResolvedValue({ ok: true, usage: { ...usage, calls24h: 12 } });
    renderPage();
    expect(await screen.findByText("Last 24 hours, 10 calls")).toBeInTheDocument();
  });

  it("top users link to their pages", async () => {
    renderPage();
    const links = await screen.findAllByRole("link", { name: "Ana Reyes" });
    expect(links[0]).toHaveAttribute("href", "/users/u1");
    const unnamed = screen.getAllByRole("link", { name: "Unnamed user" });
    expect(unnamed.map((a) => a.getAttribute("href"))).toContain("/users/u2");
  });

  it("limit hits say which limit and when", async () => {
    renderPage();
    expect(await screen.findByText(/60 an hour on Quick Utos/)).toBeInTheDocument();
    expect(screen.getByText(/300 in a day/)).toBeInTheDocument();
  });

  it("no one hit a limit", async () => {
    m.usage.mockResolvedValue({ ok: true, usage: { ...usage, limitHits: [] } });
    renderPage();
    expect(await screen.findByText("No one hit a limit.")).toBeInTheDocument();
  });

  it("has three exports", async () => {
    renderPage();
    await screen.findByText("Quick Utos");
    expect(new Set(m.exports)).toEqual(
      new Set(["ai-calls-by-feature", "ai-top-users", "ai-limit-hits"]),
    );
  });

  it("a failed load says so with the reason", async () => {
    m.usage.mockResolvedValue({ ok: false, code: "outside_service", message: "Try again." });
    renderPage();
    expect(await screen.findByText("AI usage didn't load")).toBeInTheDocument();
    expect(screen.getByText("Try again.")).toBeInTheDocument();
  });
});
