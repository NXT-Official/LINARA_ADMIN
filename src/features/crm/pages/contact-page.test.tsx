// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactDetail } from "../crm.types";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  suggest: vi.fn(),
  stage: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  del: vi.fn(),
  activity: vi.fn(),
  followUp: vi.fn(),
  done: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
  users: vi.fn(),
}));
vi.mock("../crm.actions", () => ({
  getContactFn: (...a: unknown[]) => m.get(...a),
  linkSuggestionsFn: (...a: unknown[]) => m.suggest(...a),
  setLeadStageFn: (...a: unknown[]) => m.stage(...a),
  linkContactFn: (...a: unknown[]) => m.link(...a),
  unlinkContactFn: (...a: unknown[]) => m.unlink(...a),
  deleteLeadFn: (...a: unknown[]) => m.del(...a),
  addActivityFn: (...a: unknown[]) => m.activity(...a),
  addFollowUpFn: (...a: unknown[]) => m.followUp(...a),
  completeFollowUpFn: (...a: unknown[]) => m.done(...a),
  updateContactFn: (...a: unknown[]) => m.update(...a),
  createLeadFn: vi.fn(),
}));
vi.mock("@/features/team/team.actions", () => ({
  listAdminsFn: async () => ({
    ok: true,
    admins: [{ userId: "a1", email: "ops@example.com", isYou: true }],
  }),
}));
vi.mock("@/features/users/users.actions", () => ({
  listUsersFn: (...a: unknown[]) => m.users(...a),
}));
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
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => m.navigate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { ContactPage } from "./contact-page";

const lead: ContactDetail = {
  contactId: "c1",
  userId: null,
  fullName: "Lia Santos",
  email: "lia@example.com",
  phone: null,
  kind: "lead",
  stage: "new",
  source: "facebook",
  ownerId: "a1",
  tags: ["OFW"],
  roles: [],
  householdCount: 0,
  nextFollowUpAt: null,
  createdAt: "2026-10-10T00:00:00Z",
  leadStage: "new",
  lostReason: null,
  consentBasis: null,
  linkedAt: null,
  households: [],
  activities: [
    {
      id: "a1",
      kind: "call",
      body: "<b>Called</b> about pricing",
      occurredAt: "2026-10-14T01:00:00Z",
      authorId: "a1",
    },
  ],
  followUps: [
    {
      id: "f1",
      dueAt: "2026-10-20T01:00:00Z",
      note: "Send brochure",
      assigneeId: "a1",
      doneAt: null,
    },
  ],
};
const customer: ContactDetail = {
  ...lead,
  contactId: null,
  userId: "u1",
  fullName: "Ana Reyes",
  kind: "customer",
  stage: "active",
  source: null,
  ownerId: null,
  tags: [],
  roles: ["primary_manager"],
  householdCount: 1,
  leadStage: null,
  households: [
    {
      householdId: "h1",
      name: "Reyes home",
      role: "primary_manager",
      stage: "active",
      lastActivityAt: "2026-10-14T00:00:00Z",
    },
  ],
  activities: [],
  followUps: [],
};

function renderPage(ref: { contactId: string } | { userId: string } = { contactId: "c1" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContactPage contactRef={ref} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.get.mockResolvedValue({ ok: true, contact: lead });
  m.suggest.mockResolvedValue({ ok: true, suggestions: [] });
  for (const f of [m.stage, m.link, m.unlink, m.del, m.update]) {
    f.mockResolvedValue({ ok: true, contactId: "c1" });
  }
  m.activity.mockResolvedValue({ ok: true, id: "a2" });
  m.followUp.mockResolvedValue({ ok: true, id: "f2" });
  m.done.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("ContactPage (FR-CRM-5 to FR-CRM-8, FR-CRM-12, FR-CRM-14)", () => {
  it("activity renders as text", async () => {
    renderPage();
    expect(await screen.findByText("<b>Called</b> about pricing")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("log activity is two taps", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Lia Santos" });
    fireEvent.click(screen.getByRole("button", { name: "Log activity" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What was said"), {
      target: { value: "Asked about live-in helpers" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log activity" }));
    await waitFor(() => expect(m.activity).toHaveBeenCalled());
    const sent = m.activity.mock.calls[0][0].data;
    expect(sent).toMatchObject({
      ref: { contactId: "c1" },
      kind: "call",
      body: "Asked about live-in helpers",
    });
    expect(Number.isNaN(Date.parse(sent.occurredAt))).toBe(false);
  });

  it("lost needs a reason in the dialog", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Lia Santos" });
    fireEvent.click(screen.getByRole("radio", { name: "Lost" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Mark as lost" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Why"), {
      target: { value: "Hired an agency" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(m.stage).toHaveBeenCalledWith({
        data: { contactId: "c1", stage: "lost", lostReason: "Hired an agency" },
      }),
    );
  });

  it("other stages change on one tap", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Lia Santos" });
    fireEvent.click(screen.getByRole("radio", { name: "Contacted" }));
    await waitFor(() =>
      expect(m.stage).toHaveBeenCalledWith({ data: { contactId: "c1", stage: "contacted" } }),
    );
  });

  it("suggested link is confirmed, never automatic", async () => {
    m.suggest.mockResolvedValue({
      ok: true,
      suggestions: [{ userId: "u9", fullName: "Lia Santos", email: "lia@example.com" }],
    });
    renderPage();
    expect(await screen.findByText(/matches a Linara manager account/)).toBeInTheDocument();
    expect(m.link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Link to account" }));
    await waitFor(() =>
      expect(m.link).toHaveBeenCalledWith({ data: { contactId: "c1", userId: "u9" } }),
    );
  });

  it("a lead with only a phone is linked by finding the account by hand (FR-CRM-6)", async () => {
    m.get.mockResolvedValue({ ok: true, contact: { ...lead, email: null, phone: "09171234567" } });
    m.users.mockResolvedValue({
      ok: true,
      hasMore: false,
      users: [
        {
          userId: "u7",
          fullName: "Lia Santos",
          email: "lia.s@example.com",
          kind: "primary_manager",
        },
        { userId: "u8", fullName: "Lia Helper", email: "lh@example.com", kind: "helper" },
      ],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Lia Santos" });
    expect(m.suggest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Link to an account" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Search managers by name or email"), {
      target: { value: "lia" },
    });
    await waitFor(() =>
      expect(m.users).toHaveBeenLastCalledWith({ data: { page: 0, search: "lia" } }),
    );
    // Helpers can't be linked: only managers are offered.
    expect(within(dialog).queryByText("Lia Helper")).toBeNull();
    expect(m.link).not.toHaveBeenCalled();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Link Lia Santos" }));
    await waitFor(() =>
      expect(m.link).toHaveBeenCalledWith({ data: { contactId: "c1", userId: "u7" } }),
    );
  });

  it("customers have Unlink, not Delete", async () => {
    m.get.mockResolvedValue({ ok: true, contact: { ...customer, contactId: "c2" } });
    renderPage({ contactId: "c2" });
    await screen.findByRole("heading", { name: "Ana Reyes" });
    expect(screen.getByRole("button", { name: "Unlink account" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete lead" })).toBeNull();
    expect(screen.getByRole("link", { name: "Reyes home" })).toHaveAttribute(
      "href",
      "/households/h1",
    );
  });

  it("deleting a lead asks first and returns to the list", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Lia Santos" });
    fireEvent.click(screen.getByRole("button", { name: "Delete lead" }));
    const dialog = await screen.findByRole("dialog");
    expect(m.del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete lead" }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith({ data: { contactId: "c1" } }));
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith({ to: "/crm" }));
  });

  it("follow-up can be marked done", async () => {
    renderPage();
    await screen.findByText("Send brochure");
    fireEvent.click(screen.getByRole("button", { name: "Mark done: Send brochure" }));
    await waitFor(() => expect(m.done).toHaveBeenCalledWith({ data: { followUpId: "f1" } }));
  });

  it("an unsaved manager page saves on first change and then shows the saved contact", async () => {
    m.get.mockResolvedValue({ ok: true, contact: customer });
    m.update.mockResolvedValue({ ok: true, contactId: "c-new" });
    renderPage({ userId: "u1" });
    await screen.findByRole("heading", { name: "Ana Reyes" });
    expect(m.get).toHaveBeenCalledWith({ data: { userId: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit owner and tags" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tags"), { target: { value: "OFW" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        data: { ref: { userId: "u1" }, ownerId: null, tags: "OFW" },
      }),
    );
    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({ to: "/crm/c-new", replace: true }),
    );
  });

  it("shows the contact's support tickets", async () => {
    renderPage();
    expect(await screen.findByText('Tickets for {"contactId":"c1"}')).toBeInTheDocument();
  });

  it("a saved contact with an account shows the tickets of both", async () => {
    m.get.mockResolvedValue({ ok: true, contact: { ...customer, contactId: "c2" } });
    renderPage({ contactId: "c2" });
    expect(
      await screen.findByText('Tickets for {"contactId":"c2","userId":"u1"}'),
    ).toBeInTheDocument();
  });

  it("an unknown contact shows Contact not found", async () => {
    m.get.mockResolvedValue({ ok: false, code: "not_found", message: "x" });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Contact not found" })).toBeInTheDocument();
  });
});
