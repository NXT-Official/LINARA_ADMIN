// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { PERMISSIONS } from "@/features/auth/permissions";

import { AppShell } from "./app-shell";

const ADMIN = {
  userId: "me",
  email: "ops@example.com",
  roleName: "Admin",
  preset: "admin" as const,
  permissions: [...PERMISSIONS],
};

afterEach(cleanup);

describe("AppShell", () => {
  it("the sidebar makes no server calls and shows no sample counts (D31)", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AppShell staff={ADMIN}>
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
        <AppShell staff={ADMIN}>
          <p>page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Sample data")).toBeNull();
  });

  it("nav shows only permitted screens", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell
          staff={{
            ...ADMIN,
            roleName: "Sales",
            preset: "sales",
            permissions: ["dashboard.view", "crm.view"],
          }}
        >
          <p>page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("link", { name: "CRM" }).length).toBeGreaterThan(0);
    for (const name of ["Support", "Payouts", "Team", "Audit log"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });

  it("the team screen is called Team", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell staff={ADMIN}>
          <p>page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("link", { name: "Team" })[0]).toHaveAttribute("href", "/team");
    expect(screen.queryByRole("link", { name: "Admins" })).toBeNull();
  });

  it("account menu shows the role name", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell staff={{ ...ADMIN, roleName: "Lead desk", preset: null }}>
          <p>page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Account: ops@example.com" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(await screen.findByText("Lead desk")).toBeInTheDocument();
  });
});
