// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactRow } from "../crm.types";

const m = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), admins: vi.fn(), crm: vi.fn() }));
vi.mock("../crm.actions", () => ({
  listContactsFn: (...a: unknown[]) => m.list(...a),
  createLeadFn: (...a: unknown[]) => m.create(...a),
  crmDashboardFn: (...a: unknown[]) => m.crm(...a),
}));
vi.mock("@/components/shared/charts", () => ({
  ChartSurface: ({ title, data }: { title: string; data: { key: string; value: number }[] }) => (
    <section aria-label={title}>{data.map((d) => `${d.key}:${d.value}`).join(" ")}</section>
  ),
  BarList: () => null,
}));
vi.mock("@/features/team/team.actions", () => ({ listAdminsFn: () => m.admins() }));
vi.mock("@/components/shared/export-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/shared/links", () => ({
  RowLink: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { ContactsPage } from "./contacts-page";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const row = (over: Partial<ContactRow> = {}): ContactRow => ({
  contactId: "c1",
  userId: null,
  fullName: "Lia Santos",
  email: "lia@example.com",
  phone: null,
  kind: "lead",
  stage: "new",
  source: "facebook",
  ownerId: ME,
  tags: ["OFW"],
  roles: [],
  householdCount: 0,
  nextFollowUpAt: null,
  createdAt: "2026-10-10T00:00:00Z",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContactsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.list.mockReset().mockResolvedValue({
    ok: true,
    hasMore: false,
    contacts: [
      row(),
      row({
        contactId: null,
        userId: "u0",
        fullName: "Ana Reyes",
        kind: "customer",
        stage: "active",
        source: null,
        ownerId: null,
        roles: ["primary_manager"],
        householdCount: 2,
      }),
    ],
  });
  m.create.mockReset().mockResolvedValue({ ok: true, contactId: "c9" });
  m.crm.mockReset().mockResolvedValue({
    ok: true,
    crm: {
      leadsByStage: { new: 4, contacted: 2, interested: 1, lost: 3 },
      customersByStage: { signed_up: 2, set_up: 1, active: 5, at_risk: 2, inactive: 1 },
      followUpsDueToday: 0,
      followUpsOverdue: 0,
      converted30d: 0,
      sources: { facebook: 6, referral: 1, event: 0, walk_in: 0, website: 2, other: 0 },
    },
  });
  m.admins.mockReset().mockResolvedValue({
    ok: true,
    admins: [{ userId: ME, email: "ops@example.com", isYou: true }],
  });
});
afterEach(cleanup);

describe("ContactsPage (FR-CRM-1 to FR-CRM-4, FR-CRM-8)", () => {
  it("shows contacts from the server", async () => {
    renderPage();
    // DataTable renders the table and the stacked phone cards (NFR-3): each row twice.
    expect((await screen.findAllByRole("link", { name: "Lia Santos" }))[0]).toHaveAttribute(
      "href",
      "/crm/c1",
    );
    expect(screen.getAllByText("You")[0]).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { page: 0 } });
  });

  it("charts show sources and lead stages from the server", async () => {
    renderPage();
    expect(await screen.findByLabelText("Where contacts come from")).toHaveTextContent(
      "facebook:6",
    );
    expect(screen.getByLabelText("Leads by stage")).toHaveTextContent("lost:3");
  });

  it("starts from a dashboard link's filters", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ContactsPage initial={{ kind: "customer", stage: "at_risk" }} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(m.list).toHaveBeenCalledWith({
        data: { page: 0, kind: "customer", stage: "at_risk" },
      }),
    );
  });

  it("unsaved managers link to their account page", async () => {
    renderPage();
    expect((await screen.findAllByRole("link", { name: "Ana Reyes" }))[0]).toHaveAttribute(
      "href",
      "/crm/account/u0",
    );
  });

  it("filters go to the server and reset the page", async () => {
    m.list.mockResolvedValue({ ok: true, hasMore: true, contacts: [row()] });
    renderPage();
    await screen.findAllByRole("link", { name: "Lia Santos" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith({ data: { page: 1 } }));

    fireEvent.click(screen.getByRole("radio", { name: "Leads" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({ data: { page: 0, kind: "lead" } }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Mine" }));
    fireEvent.click(screen.getByRole("radio", { name: "Overdue" }));
    await waitFor(() =>
      expect(m.list).toHaveBeenLastCalledWith({
        data: { page: 0, kind: "lead", owner: "mine", due: "overdue" },
      }),
    );
  });

  it("adding a lead posts it and refreshes the list", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Lia Santos" });
    const calls = m.list.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Add lead" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Nina Ramos" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), {
      target: { value: "0918 111 2222" },
    });
    fireEvent.change(within(dialog).getByLabelText("Tags"), { target: { value: "OFW, Cebu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add lead" }));
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        data: {
          fullName: "Nina Ramos",
          email: "",
          phone: "0918 111 2222",
          source: null,
          ownerId: null,
          tags: "OFW, Cebu",
          note: "",
        },
      }),
    );
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(calls));
  });

  it("add lead shows the server's message", async () => {
    m.create.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "A lead needs an email or a phone number.",
    });
    renderPage();
    await screen.findAllByRole("link", { name: "Lia Santos" });
    fireEvent.click(screen.getByRole("button", { name: "Add lead" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Nina" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add lead" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A lead needs an email or a phone number.",
    );
  });
});
