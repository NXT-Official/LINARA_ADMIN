import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));

import { ConsoleError } from "@/lib/console-error";

import {
  crmDashboardHandler,
  getContactHandler,
  linkSuggestionsHandler,
  listContactsHandler,
} from "./crm.handlers.server";
import {
  addActivityHandler,
  addFollowUpHandler,
  completeFollowUpHandler,
  createLeadHandler,
  deleteLeadHandler,
  linkContactHandler,
  setLeadStageHandler,
  unlinkContactHandler,
  updateContactHandler,
} from "./crm.writes.server";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const NOW = "2026-10-15T04:00:00.000Z";

const dbRow = (i: number) => ({
  contact_id: i === 0 ? null : `c${i}`,
  user_id: i === 0 ? "u0" : null,
  full_name: `Person ${i}`,
  email: null,
  phone: "09171234567",
  kind: i === 0 ? "customer" : "lead",
  stage: i === 0 ? "active" : "new",
  source: i === 0 ? null : "facebook",
  owner_id: null,
  tags: ["OFW"],
  roles: i === 0 ? ["primary_manager"] : [],
  household_count: i === 0 ? 1 : 0,
  next_follow_up_at: null,
  created_at: "2026-10-01T00:00:00Z",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("listContactsHandler (FR-CRM-3, FR-CRM-4, FR-CRM-8, FR-CRM-9)", () => {
  it("checks crm.view first", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(listContactsHandler({ page: 0 })).resolves.toMatchObject({ code: "not_allowed" });
    expect(m.requireStaff).toHaveBeenCalledWith("crm.view");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("pages 50 with one extra row, stage limits from STAGE_DAYS", async () => {
    m.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => dbRow(i)), error: null });
    const res = await listContactsHandler({ page: 1 });
    expect(m.rpc).toHaveBeenCalledWith("crm_list_contacts", {
      p_search: null,
      p_kind: null,
      p_stage: null,
      p_owner: null,
      p_tag: null,
      p_role: null,
      p_due: null,
      p_limit: 51,
      p_offset: 50,
      p_now: NOW,
      p_active_days: 7,
      p_at_risk_days: 30,
    });
    expect(res).toMatchObject({ ok: true, hasMore: true });
    if (res.ok) {
      expect(res.contacts).toHaveLength(50);
      expect(res.contacts[0]).toEqual({
        contactId: null,
        userId: "u0",
        fullName: "Person 0",
        email: null,
        phone: "09171234567",
        kind: "customer",
        stage: "active",
        source: null,
        ownerId: null,
        tags: ["OFW"],
        roles: ["primary_manager"],
        householdCount: 1,
        nextFollowUpAt: null,
        createdAt: "2026-10-01T00:00:00Z",
      });
    }
  });

  it("mine uses the caller's id, and filters pass through", async () => {
    await listContactsHandler({
      page: 0,
      owner: "mine",
      kind: "lead",
      stage: "interested",
      tag: " OFW ",
      role: "co_manager",
      due: "overdue",
      search: " lia ",
    });
    expect(m.rpc).toHaveBeenCalledWith(
      "crm_list_contacts",
      expect.objectContaining({
        p_owner: ME,
        p_kind: "lead",
        p_stage: "interested",
        p_tag: "OFW",
        p_role: "co_manager",
        p_due: "overdue",
        p_search: "lia",
      }),
    );
  });

  it("refuses unknown filters before querying", async () => {
    for (const bad of [
      { stage: "won" },
      { kind: "partner" },
      { tag: "x".repeat(31) },
      { role: "helper" },
      { due: "tomorrow" },
      { owner: "theirs" },
    ]) {
      await expect(listContactsHandler({ page: 0, ...(bad as object) })).resolves.toMatchObject({
        code: "invalid_input",
      });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("getContactHandler (FR-CRM-12)", () => {
  it("by contact id or by a manager's user id", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await getContactHandler({ contactId: ID });
    expect(m.rpc).toHaveBeenLastCalledWith("crm_get_contact", {
      p_contact_id: ID,
      p_user_id: null,
      p_now: NOW,
      p_active_days: 7,
      p_at_risk_days: 30,
    });
    await getContactHandler({ userId: ID });
    expect(m.rpc).toHaveBeenLastCalledWith(
      "crm_get_contact",
      expect.objectContaining({ p_contact_id: null, p_user_id: ID }),
    );
  });

  it("malformed ids are not_found without a query", async () => {
    await expect(getContactHandler({ contactId: "nope" })).resolves.toMatchObject({
      code: "not_found",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("missing contact is not_found", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getContactHandler({ contactId: ID })).resolves.toMatchObject({
      code: "not_found",
    });
  });

  it("maps the detail", async () => {
    m.rpc.mockResolvedValue({
      error: null,
      data: {
        ...dbRow(1),
        lead_stage: "new",
        lost_reason: null,
        consent_basis: null,
        linked_at: null,
        households: [
          {
            household_id: "h1",
            name: "Reyes home",
            role: "primary_manager",
            stage: "active",
            last_activity_at: "2026-10-14T00:00:00Z",
          },
        ],
        activities: [
          {
            id: "a1",
            kind: "call",
            body: "Hi",
            occurred_at: "2026-10-14T00:00:00Z",
            author_id: ME,
          },
        ],
        follow_ups: [
          {
            id: "f1",
            due_at: "2026-10-16T00:00:00Z",
            note: "Call",
            assignee_id: ME,
            done_at: null,
          },
        ],
      },
    });
    const res = await getContactHandler({ contactId: ID });
    expect(res).toMatchObject({
      ok: true,
      contact: {
        contactId: "c1",
        leadStage: "new",
        households: [
          { householdId: "h1", name: "Reyes home", role: "primary_manager", stage: "active" },
        ],
        activities: [{ id: "a1", kind: "call", body: "Hi", authorId: ME }],
        followUps: [{ id: "f1", note: "Call", assigneeId: ME, doneAt: null }],
      },
    });
  });
});

describe("linkSuggestionsHandler and crmDashboardHandler", () => {
  it("suggestions for a contact", async () => {
    m.rpc.mockResolvedValue({
      data: [{ user_id: "u3", full_name: "Mia Lopez", email: "mia@example.com" }],
      error: null,
    });
    await expect(linkSuggestionsHandler({ contactId: ID })).resolves.toEqual({
      ok: true,
      suggestions: [{ userId: "u3", fullName: "Mia Lopez", email: "mia@example.com" }],
    });
    expect(m.rpc).toHaveBeenCalledWith("crm_link_suggestions", { p_contact_id: ID });
  });

  it("dashboard figures", async () => {
    const data = {
      leads_by_stage: { new: 2, contacted: 0, interested: 1, lost: 1 },
      customers_by_stage: { signed_up: 1, set_up: 0, active: 1, at_risk: 1, inactive: 0 },
      follow_ups_due_today: 1,
      follow_ups_overdue: 1,
      converted_30d: 1,
      sources: { facebook: 1, referral: 1, event: 1, walk_in: 0, website: 0, other: 0 },
    };
    m.rpc.mockResolvedValue({ data, error: null });
    await expect(crmDashboardHandler()).resolves.toEqual({
      ok: true,
      crm: {
        leadsByStage: data.leads_by_stage,
        customersByStage: data.customers_by_stage,
        followUpsDueToday: 1,
        followUpsOverdue: 1,
        converted30d: 1,
        sources: data.sources,
      },
    });
    expect(m.rpc).toHaveBeenCalledWith("crm_dashboard", {
      p_now: NOW,
      p_active_days: 7,
      p_at_risk_days: 30,
    });
  });
});

describe("write handlers (D34)", () => {
  it("writes check crm.write first and validate before querying", async () => {
    m.requireStaff.mockRejectedValue(new ConsoleError("not_allowed"));
    await expect(
      createLeadHandler({ fullName: "Lia", email: "lia@example.com" }),
    ).resolves.toMatchObject({ code: "not_allowed" });
    expect(m.requireStaff).toHaveBeenCalledWith("crm.write");
    m.requireStaff.mockReset();
    await expect(createLeadHandler({ fullName: "Lia" })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("creates a lead with the actor and cleaned fields", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await expect(
      createLeadHandler({ fullName: " Lia ", phone: "0917 123 4567", tags: "OFW", note: "Hi" }),
    ).resolves.toEqual({ ok: true, contactId: ID });
    expect(m.rpc).toHaveBeenCalledWith("crm_create_lead", {
      p_actor: ME,
      p_full_name: "Lia",
      p_email: null,
      p_phone: "09171234567",
      p_source: null,
      p_owner_id: null,
      p_tags: ["OFW"],
      p_note: "Hi",
    });
  });

  it("a rule break shows its message", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That account already has a CRM contact." },
    });
    await expect(linkContactHandler({ contactId: ID, userId: ID })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That account already has a CRM contact.",
    });
  });

  it("other database errors say nothing", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(deleteLeadHandler({ contactId: ID })).resolves.toMatchObject({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
  });

  it("owner on an unsaved manager saves the contact first", async () => {
    m.rpc
      .mockResolvedValueOnce({ data: "c-new", error: null })
      .mockResolvedValueOnce({ data: "c-new", error: null });
    await expect(
      updateContactHandler({ ref: { userId: ID }, ownerId: ME, tags: ["OFW"] }),
    ).resolves.toEqual({ ok: true, contactId: "c-new" });
    expect(m.rpc.mock.calls.map((c) => c[0])).toEqual(["crm_ensure_contact", "crm_update_contact"]);
    expect(m.rpc).toHaveBeenLastCalledWith("crm_update_contact", {
      p_actor: ME,
      p_contact_id: "c-new",
      p_full_name: null,
      p_email: null,
      p_phone: null,
      p_source: null,
      p_owner_id: ME,
      p_tags: ["OFW"],
    });
  });

  it("a lead's details are edited in full", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await updateContactHandler({
      ref: { contactId: ID },
      details: { fullName: "Lia S", email: "LIA@example.com", source: "event", tags: "Cebu" },
    });
    expect(m.rpc).toHaveBeenCalledWith(
      "crm_update_contact",
      expect.objectContaining({
        p_full_name: "Lia S",
        p_email: "lia@example.com",
        p_tags: ["Cebu"],
      }),
    );
  });

  it("lost needs a reason before querying", async () => {
    await expect(
      setLeadStageHandler({ contactId: ID, stage: "lost", lostReason: " " }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("an activity on an unsaved manager goes by user id", async () => {
    m.rpc.mockResolvedValue({ data: "a1", error: null });
    await addActivityHandler({
      ref: { userId: ID },
      kind: "call",
      body: " Called ",
      occurredAt: NOW,
    });
    expect(m.rpc).toHaveBeenCalledWith("crm_add_activity", {
      p_actor: ME,
      p_contact_id: null,
      p_user_id: ID,
      p_kind: "call",
      p_body: "Called",
      p_occurred_at: NOW,
    });
  });

  it("follow-ups are added and completed", async () => {
    m.rpc.mockResolvedValue({ data: "f1", error: null });
    await addFollowUpHandler({
      ref: { contactId: ID },
      dueAt: "2026-10-20T00:00:00Z",
      note: "Call",
      assigneeId: ME,
    });
    expect(m.rpc).toHaveBeenLastCalledWith("crm_add_follow_up", {
      p_actor: ME,
      p_contact_id: ID,
      p_user_id: null,
      p_due_at: "2026-10-20T00:00:00.000Z",
      p_note: "Call",
      p_assignee_id: ME,
    });
    await completeFollowUpHandler({ followUpId: ID });
    expect(m.rpc).toHaveBeenLastCalledWith("crm_complete_follow_up", {
      p_actor: ME,
      p_follow_up_id: ID,
    });
    await expect(completeFollowUpHandler({ followUpId: "x" })).resolves.toMatchObject({
      code: "not_found",
    });
  });

  it("unlink and delete pass the contact", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await unlinkContactHandler({ contactId: ID });
    expect(m.rpc).toHaveBeenLastCalledWith("crm_unlink_contact", { p_actor: ME, p_contact_id: ID });
    await deleteLeadHandler({ contactId: ID });
    expect(m.rpc).toHaveBeenLastCalledWith("crm_delete_lead", { p_actor: ME, p_contact_id: ID });
  });
});
