// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserDetail } from "../users.types";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../users.actions", () => ({ getUserFn: (...a: unknown[]) => m.get(...a) }));
vi.mock("@/features/pay/pay.actions", () => ({ revealPayFn: vi.fn() }));
vi.mock("@/features/audit/components/audit-trail", () => ({ AuditTrail: () => null }));
vi.mock("@/components/shared/links", () => {
  const A = ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>;
  return { RowLink: A, RecordLink: A, BackLink: A };
});

import { UserPage } from "./user-page";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const helper: UserDetail = {
  userId: ID,
  fullName: "Carla Dizon",
  email: "carla@example.com",
  kind: "helper",
  joinedAt: "2026-10-03T00:00:00Z",
  lastSignInAt: null,
  suspended: false,
  devices: 1,
  memberships: [],
  jobs: [
    {
      helperId: "hp1",
      householdId: "h1",
      householdName: "Reyes home",
      station: "Kitchen",
      employment: "live-in",
      status: "ACTIVE",
      startedOn: "2026-09-01",
      endedOn: null,
      alsoWorksIn: [{ householdId: "h2", householdName: "Cruz home" }],
    },
  ],
  deletion: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UserPage userId={ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => m.get.mockReset().mockResolvedValue({ ok: true, user: helper }));
afterEach(cleanup);

describe("UserPage (FR-US-3, FR-US-6)", () => {
  it("shows a helper's jobs with pay hidden", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Carla Dizon" })).toBeInTheDocument();
    expect(m.get).toHaveBeenCalledWith({ data: { userId: ID } });
    expect(screen.getByRole("link", { name: "Reyes home" })).toHaveAttribute(
      "href",
      "/households/h1",
    );
    expect(screen.getByRole("link", { name: "Cruz home" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show Carla Dizon's monthly wage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show Carla Dizon's payout account" }),
    ).toBeInTheDocument();
  });

  it("later phases say when they arrive, and there is no suspend yet", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Carla Dizon" });
    expect(screen.getByText(/Arrives with Support \(Phase 5\)/)).toBeInTheDocument();
    expect(screen.getByText(/Arrives with the CRM \(Phase 3\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suspend/i })).toBeNull();
  });

  it("shows a pending deletion request", async () => {
    m.get.mockResolvedValue({
      ok: true,
      user: { ...helper, deletion: { id: "d1", requestedAt: new Date().toISOString() } },
    });
    renderPage();
    expect(await screen.findByText(/Asked to delete their account/)).toBeInTheDocument();
  });

  it("an unknown user shows User not found", async () => {
    m.get.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "There's no user with this address.",
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "User not found" })).toBeInTheDocument();
  });
});
