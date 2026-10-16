// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sup: vi.fn(), del: vi.fn(), pay: vi.fn() }));
vi.mock("@/features/support/support.actions", () => ({
  supportCountsFn: (...a: unknown[]) => m.sup(...a),
}));
vi.mock("@/features/deletions/deletions.actions", () => ({
  deletionCountsFn: (...a: unknown[]) => m.del(...a),
}));
vi.mock("@/features/payouts/payouts.actions", () => ({
  payoutCountsFn: (...a: unknown[]) => m.pay(...a),
}));
vi.mock("@/features/auth/auth.actions", () => ({ signOutFn: vi.fn() }));
vi.mock("@/components/shared/env-badge", () => ({ EnvBadge: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouterState: () => "/",
}));

import { AppShell } from "./app-shell";

afterEach(cleanup);

describe("AppShell", () => {
  it("the sidebar makes no server calls and shows no sample counts (D31)", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AppShell staff={{ userId: "me", email: "ops@example.com", role: "admin" }}>
          <p>page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("link", { name: "Payouts" })[0]).toHaveTextContent(/^Payouts$/);
    expect(screen.getAllByRole("link", { name: "Support" })[0]).toHaveTextContent(/^Support$/);
    expect(m.sup).not.toHaveBeenCalled();
    expect(m.del).not.toHaveBeenCalled();
    expect(m.pay).not.toHaveBeenCalled();
  });

  it("every screen is on live data, so there is no Sample data label", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell staff={{ userId: "me", email: "ops@example.com", role: "admin" }}>
          <p>page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Sample data")).toBeNull();
  });
});
