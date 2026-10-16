// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardData } from "../dashboard.types";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  crm: vi.fn(),
  del: vi.fn(),
  sup: vi.fn(),
  pay: vi.fn(),
  ai: vi.fn(),
}));
vi.mock("../dashboard.actions", () => ({ getDashboardFn: (...a: unknown[]) => m.get(...a) }));
vi.mock("@/features/crm/crm.actions", () => ({ crmDashboardFn: (...a: unknown[]) => m.crm(...a) }));
vi.mock("@/features/support/support.actions", () => ({
  supportCountsFn: (...a: unknown[]) => m.sup(...a),
}));
vi.mock("@/features/payouts/payouts.actions", () => ({
  payoutCountsFn: (...a: unknown[]) => m.pay(...a),
}));
vi.mock("@/features/ai/ai.actions", () => ({ aiUsageFn: (...a: unknown[]) => m.ai(...a) }));
vi.mock("@/features/deletions/deletions.actions", () => ({
  deletionCountsFn: (...a: unknown[]) => m.del(...a),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    className,
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search)}` : to} className={className}>
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

const crm = {
  leadsByStage: { new: 4, contacted: 2, interested: 1, lost: 3 },
  customersByStage: { signed_up: 2, set_up: 1, active: 5, at_risk: 2, inactive: 1 },
  followUpsDueToday: 3,
  followUpsOverdue: 2,
  converted30d: 1,
  sources: { facebook: 1, referral: 0, event: 0, walk_in: 0, website: 0, other: 0 },
};

beforeEach(() => {
  m.get.mockReset().mockResolvedValue({ ok: true, data });
  m.crm.mockReset().mockResolvedValue({ ok: true, crm });
  m.sup.mockReset().mockResolvedValue({ ok: true, counts: { open: 5, pending: 2, unassigned: 3 } });
  m.del.mockReset().mockResolvedValue({ ok: true, counts: { pending: 4, dueSoon: 1, overdue: 2 } });
  m.pay.mockReset().mockResolvedValue({
    ok: true,
    counts: { failed: 6, cancelled: 1, unclear: 2, stuck: 3, no_answer: 0 },
  });
  m.ai.mockReset().mockResolvedValue({
    ok: true,
    usage: {
      hourly: [],
      topUsers: [],
      limitHits: [
        { userId: "u1", name: null, kind: "hourly", fn: "route-utos", at: "2026-10-16T01:00:00Z" },
        { userId: "u1", name: null, kind: "daily", fn: null, at: "2026-10-16T02:00:00Z" },
        { userId: "u2", name: null, kind: "daily", fn: null, at: "2026-10-16T03:00:00Z" },
      ],
      calls24h: 1234,
    },
  });
});
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

  it("payout figures link to the filtered list (FR-DB-6, FR-DB-8)", async () => {
    renderPage();
    const failed = await screen.findByRole("link", { name: /^Failed/ });
    expect(failed).toHaveAttribute("href", "/payouts?kind=failed");
    expect(failed).toHaveTextContent("6");
    expect(screen.getByRole("link", { name: /^Unclear/ })).toHaveAttribute(
      "href",
      "/payouts?kind=unclear",
    );
    expect(screen.getByRole("link", { name: /^Stuck sending/ })).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: /^Cancelled at Xendit/ })).toHaveAttribute(
      "href",
      "/payouts?kind=cancelled",
    );
    expect(screen.getByRole("link", { name: /^No answer from Xendit/ })).toHaveTextContent("0");
  });

  it("AI calls in 24h and users who hit a limit link to AI usage (FR-DB-6)", async () => {
    renderPage();
    const calls = await screen.findByRole("link", { name: /^AI calls in 24 hours/ });
    expect(calls).toHaveAttribute("href", "/ai");
    expect(calls).toHaveTextContent("1,234");
    const limited = screen.getByRole("link", { name: /^People who hit an AI limit/ });
    expect(limited).toHaveAttribute("href", "/ai");
    expect(limited).toHaveTextContent("2");
  });

  it("a failed payout or AI load shows Unavailable, never 0 (FR-DB-9)", async () => {
    m.pay.mockResolvedValue({ ok: false, code: "outside_service", message: "Payouts down." });
    m.ai.mockResolvedValue({ ok: false, code: "outside_service", message: "AI down." });
    renderPage();
    expect(await screen.findByText("The payout figures didn't load")).toBeInTheDocument();
    expect(await screen.findByText("The AI figures didn't load")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Failed/ })).toBeNull();
  });

  it("the Not on live data yet panel is gone", async () => {
    renderPage();
    await screen.findByRole("link", { name: /^Households/ });
    expect(screen.queryByText("Not on live data yet")).toBeNull();
    expect(screen.queryByText(/arrive in Phase 6/)).toBeNull();
  });

  it("CRM figures link to filtered lists (FR-DB-7, FR-DB-8)", async () => {
    renderPage();
    const overdue = await screen.findByRole("link", { name: /Follow-ups overdue/ });
    expect(overdue).toHaveAttribute("href", "/crm?due=overdue");
    expect(overdue).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /Follow-ups due today/ })).toHaveAttribute(
      "href",
      "/crm?due=today",
    );
    expect(screen.getByRole("link", { name: /^At risk/ })).toHaveAttribute(
      "href",
      "/crm?kind=customer&stage=at_risk",
    );
    expect(screen.getByRole("link", { name: /^New/ })).toHaveAttribute(
      "href",
      "/crm?kind=lead&stage=new",
    );
    expect(screen.getByRole("link", { name: /Became customers/ })).toHaveTextContent("1");
  });

  it("support figures link to filtered lists (FR-DB-5, FR-DB-8)", async () => {
    renderPage();
    const open = await screen.findByRole("link", { name: /^Open tickets/ });
    expect(open).toHaveAttribute("href", "/support?status=open");
    expect(open).toHaveTextContent("5");
    expect(screen.getByRole("link", { name: /^Waiting on the user/ })).toHaveAttribute(
      "href",
      "/support?status=pending",
    );
    expect(screen.getByRole("link", { name: /^Not assigned/ })).toHaveAttribute(
      "href",
      "/support?status=active&assignee=unassigned",
    );
    expect(screen.queryByText(/Support tickets: arrive in Phase 5/)).toBeNull();
  });

  it("deletion figures link to the list (FR-DB-4)", async () => {
    renderPage();
    const pending = await screen.findByRole("link", { name: /^Deletion requests waiting/ });
    expect(pending).toHaveAttribute("href", "/deletions");
    expect(pending).toHaveTextContent("4");
    expect(screen.getByRole("link", { name: /^Past the 30-day deadline/ })).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /^Due within 7 days/ })).toHaveTextContent("1");
    expect(screen.queryByText(/Deletion requests: arrive in Phase 4/)).toBeNull();
  });

  it("a CRM failure shows Unavailable, other sections still show", async () => {
    m.crm.mockResolvedValue({ ok: false, code: "outside_service", message: "CRM is down." });
    renderPage();
    expect(await screen.findByText("The CRM figures didn't load")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Households/ })).toBeInTheDocument();
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
