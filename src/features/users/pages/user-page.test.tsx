// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserDetail } from "../users.types";

const m = vi.hoisted(() => ({ get: vi.fn(), suspend: vi.fn() }));
vi.mock("../users.actions", () => ({
  getUserFn: (...a: unknown[]) => m.get(...a),
  setSuspendedFn: (...a: unknown[]) => m.suspend(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

// input-otp measures itself and looks for password managers; jsdom has neither API.
document.elementFromPoint ??= () => null;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
vi.mock("@/features/pay/pay.actions", () => ({ revealPayFn: vi.fn() }));
vi.mock("@/features/support/components/record-tickets", () => ({
  RecordTickets: ({ filter }: { filter: Record<string, string> }) => (
    <p>Tickets for {JSON.stringify(filter)}</p>
  ),
}));
vi.mock("@/features/audit/components/audit-trail", () => ({ AuditTrail: () => null }));
vi.mock("@/components/shared/links", () => {
  const A = ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>;
  return { RowLink: A, RecordLink: A, BackLink: A };
});

import { UserPage } from "./user-page";
import { asRole, SUPPORT } from "@/features/auth/staff.test-utils";

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

  it("later phases say when they arrive", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Carla Dizon" });
    expect(screen.getByText(`Tickets for {"userId":"${ID}"}`)).toBeInTheDocument();
    expect(screen.queryByText(/Arrives with the CRM/)).toBeNull();
    // Helpers aren't CRM contacts (§5.2.1).
    expect(screen.queryByRole("link", { name: "Open in CRM" })).toBeNull();
  });

  it("a manager links to their CRM contact", async () => {
    m.get.mockResolvedValue({
      ok: true,
      user: {
        ...helper,
        kind: "primary_manager",
        jobs: [],
        memberships: [{ householdId: "h1", householdName: "Reyes home", role: "primary_manager" }],
      },
    });
    renderPage();
    expect(await screen.findByRole("link", { name: "Open in CRM" })).toHaveAttribute(
      "href",
      `/crm/account/${ID}`,
    );
  });

  it("Suspend asks for a reason and the code", async () => {
    m.suspend.mockResolvedValue({ ok: true });
    renderPage();
    await screen.findByRole("heading", { name: "Carla Dizon" });
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/session keeps working until it expires, up to about an hour/),
    ).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Suspend" });
    fireEvent.change(within(dialog).getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Reported by a household" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(m.suspend).toHaveBeenCalledWith({
        data: { userId: ID, suspended: true, reason: "Reported by a household", code: "123456" },
      }),
    );
  });

  it("a suspended user shows Unsuspend", async () => {
    m.get.mockResolvedValue({ ok: true, user: { ...helper, suspended: true } });
    renderPage();
    await screen.findByRole("heading", { name: "Carla Dizon" });
    expect(screen.getByRole("button", { name: "Unsuspend" })).toBeInTheDocument();
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

describe("permissions (FR-RL-8)", () => {
  it("no Suspend and no Show pay without their permissions", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <UserPage userId={ID} />
      </QueryClientProvider>,
      { wrapper: asRole(SUPPORT) },
    );
    await screen.findByRole("heading", { name: "Carla Dizon" });
    expect(screen.queryByRole("button", { name: /^(Suspend|Unsuspend)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });
});
