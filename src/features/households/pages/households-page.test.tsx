// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HouseholdDetail, HouseholdRow } from "../households.types";

const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("../households.actions", () => ({
  listHouseholdsFn: (...a: unknown[]) => m.list(...a),
  getHouseholdFn: (...a: unknown[]) => m.get(...a),
}));
vi.mock("@/features/pay/pay.actions", () => ({ revealPayFn: vi.fn() }));
vi.mock("@/features/audit/components/audit-trail", () => ({ AuditTrail: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/shared/links", () => {
  const A = ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>;
  return { RowLink: A, RecordLink: A, BackLink: A };
});

import { HouseholdPage } from "./household-page";
import { HouseholdsPage } from "./households-page";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const row = (over: Partial<HouseholdRow> = {}): HouseholdRow => ({
  householdId: "h1",
  name: "Reyes home",
  createdAt: "2026-10-12T01:00:00Z",
  primaryManagerId: "u1",
  primaryManagerName: "Ana Reyes",
  managers: 2,
  helpersActive: 1,
  lastActivityAt: null,
  tasksScheduled7d: 0,
  tasksDone7d: 0,
  ...over,
});
const detail: HouseholdDetail = {
  householdId: ID,
  name: "Reyes home",
  createdAt: "2026-10-12T01:00:00Z",
  timezone: "Asia/Manila",
  managers: [{ userId: "u1", fullName: "Ana Reyes", role: "primary_manager" }],
  helpers: [
    {
      helperId: "hp1",
      userId: "u3",
      name: "Carla Dizon",
      station: "Kitchen",
      employment: "live-in",
      status: "ACTIVE",
      startedOn: "2026-09-01",
      endedOn: null,
      shared: true,
    },
    {
      helperId: "hp2",
      userId: null,
      name: "Dina",
      station: null,
      employment: null,
      status: "PENDING_CLAIM",
      startedOn: null,
      endedOn: null,
      shared: false,
    },
  ],
  tasksScheduled7d: 3,
  tasksDone7d: 2,
  tasksDone30d: 9,
  lastActivityAt: null,
};

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  m.list.mockReset().mockResolvedValue({ ok: true, households: [row()], hasMore: false });
  m.get.mockReset().mockResolvedValue({ ok: true, household: detail });
});
afterEach(cleanup);

describe("HouseholdsPage (FR-HH-1)", () => {
  it("shows households from the server", async () => {
    withQuery(<HouseholdsPage />);
    expect((await screen.findAllByRole("link", { name: "Reyes home" }))[0]).toHaveAttribute(
      "href",
      "/households/h1",
    );
    expect(screen.getAllByText("Ana Reyes")[0]).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0 } });
  });

  it("household without tasks says No tasks yet", async () => {
    withQuery(<HouseholdsPage />);
    expect((await screen.findAllByText("No tasks yet"))[0]).toBeInTheDocument();
  });

  it("searches by name on the server", async () => {
    withQuery(<HouseholdsPage />);
    await screen.findAllByRole("link", { name: "Reyes home" });
    fireEvent.change(screen.getByLabelText("Search household name"), {
      target: { value: "reyes" },
    });
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 0, search: "reyes" } }),
    );
  });
});

describe("HouseholdPage (FR-HH-2, FR-US-6)", () => {
  it("invited helper renders without a link", async () => {
    withQuery(<HouseholdPage householdId={ID} />);
    expect(await screen.findByRole("heading", { name: "Reyes home" })).toBeInTheDocument();
    expect(screen.getByText("Dina")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dina" })).toBeNull();
    expect(screen.getByRole("link", { name: "Carla Dizon" })).toHaveAttribute("href", "/users/u3");
  });

  it("marks shared helpers and hides pay", async () => {
    withQuery(<HouseholdPage householdId={ID} />);
    await screen.findByRole("heading", { name: "Reyes home" });
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show Carla Dizon's monthly wage" }),
    ).toBeInTheDocument();
  });

  it("shows activity counts and when later phases arrive", async () => {
    withQuery(<HouseholdPage householdId={ID} />);
    await screen.findByRole("heading", { name: "Reyes home" });
    expect(screen.getByText("Tasks scheduled, last 7 days")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText(/Arrives with Support \(Phase 5\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Arrives with the CRM/)).toBeNull();
    expect(screen.getByRole("link", { name: "CRM: Ana Reyes" })).toHaveAttribute(
      "href",
      "/crm/account/u1",
    );
  });

  it("an unknown household shows Household not found", async () => {
    m.get.mockResolvedValue({ ok: false, code: "not_found", message: "x" });
    withQuery(<HouseholdPage householdId={ID} />);
    expect(await screen.findByRole("heading", { name: "Household not found" })).toBeInTheDocument();
  });
});
