// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveBilling } from "@/features/billing/billing.types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

// Only the server is mocked, and its first read is held open so the loading state shows.
const server = vi.hoisted(() => ({
  loadBillingFn: vi.fn(),
  catalogActionFn: vi.fn(),
  billingActionFn: vi.fn(),
  testShiftFn: vi.fn(),
}));
vi.mock("@/features/billing/billing.actions", () => server);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let answer: (v: unknown) => void = () => {};
beforeEach(() => {
  // A fresh store per test: it's a module singleton that loads once.
  vi.resetModules();
  server.loadBillingFn.mockImplementation(
    () =>
      new Promise((r) => {
        answer = r;
      }),
  );
});
afterEach(() => {
  cleanup();
  server.loadBillingFn.mockReset();
});

async function live(): Promise<LiveBilling> {
  const { SAMPLE_CATALOG } = await import("../plans.sample");
  return {
    state: {
      ...SAMPLE_CATALOG,
      plans: SAMPLE_CATALOG.plans.map((p) =>
        p.id === "normal" ? { ...p, content: { ...p.content, name: "Normal (live)" } } : p,
      ),
      subscriptions: [],
      payments: [],
    },
    testTools: false,
  };
}
// The store reads through a dynamic import, so the call lands a moment after render.
const asked = () => vi.waitFor(() => expect(server.loadBillingFn).toHaveBeenCalledTimes(1));
const settle = async (v: unknown) => {
  await asked();
  await act(async () => {
    answer(v);
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("billing screens before the first read answers", () => {
  it("Subscriptions shows a skeleton, not the sample households, then the real data", async () => {
    const { BillingPage } = await import("@/features/billing/pages/billing-page");
    render(<BillingPage />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.getByText("Loading subscriptions")).toBeInTheDocument();
    expect(screen.queryByText(/Santos home/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    expect(screen.queryByText(/preview on sample data/)).not.toBeInTheDocument();
    await asked();
    await settle(await live());
    expect(screen.queryByText("Loading subscriptions")).not.toBeInTheDocument();
    expect(screen.queryByText(/Santos home/)).not.toBeInTheDocument();
    expect(screen.queryByText(/preview on sample data/)).not.toBeInTheDocument();
  });

  it("Plans shows a skeleton, then the real catalog", async () => {
    const { PlansPage } = await import("./plans-page");
    render(<PlansPage />);
    expect(screen.getByText("Loading plans")).toBeInTheDocument();
    expect(screen.queryByText("Normal")).not.toBeInTheDocument();
    await settle(await live());
    expect(screen.queryByText("Loading plans")).not.toBeInTheDocument();
    expect(screen.getAllByText("Normal (live)").length).toBeGreaterThan(0);
  });

  it("a plan opened by its link loads instead of saying it isn't there", async () => {
    const { PlanPage } = await import("./plan-page");
    render(<PlanPage planId="normal" />);
    expect(screen.getByText("Loading the plan")).toBeInTheDocument();
    expect(screen.queryByText("Plan not found")).not.toBeInTheDocument();
    await asked();
    await settle(await live());
    expect(screen.getAllByDisplayValue("Normal (live)").length).toBeGreaterThan(0);
  });

  it("Global switches shows a skeleton first", async () => {
    const { SwitchesPage } = await import("./switches-page");
    render(<SwitchesPage />);
    expect(screen.getByText("Loading switches")).toBeInTheDocument();
    await settle(await live());
    expect(screen.queryByText("Loading switches")).not.toBeInTheDocument();
  });

  it("where billing isn't set up (the read fails), it falls back to the sample and says so", async () => {
    const { PlansPage } = await import("./plans-page");
    render(<PlansPage />);
    await settle({ ok: false, code: "outside_service", message: "x" });
    expect(screen.queryByText("Loading plans")).not.toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText(/preview on sample data/)).toBeInTheDocument();
  });
});
