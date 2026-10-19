import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn(), log: vi.fn() }));

vi.mock("@/features/auth/session.server", () => ({
  requireStaff: (...a: unknown[]) => m.requireStaff(...a),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/log.server", () => ({ logError: (...a: unknown[]) => m.log(...a) }));

import { deleteFaqHandler, listFaqsHandler, saveFaqHandler } from "./faq.handlers.server";

const ME = "7f0c2a7e-1b2c-4d5e-8f90-000000000001";
const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const GOOD = {
  question: "  How do I reset my PIN? ",
  answer: " Open Settings. ",
  category: "",
  sortOrder: 2,
  published: true,
};

beforeEach(() => {
  m.requireStaff.mockReset().mockResolvedValue({ userId: ME });
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  m.log.mockReset();
});

describe("faq handlers", () => {
  it("lists entries after checking faq.manage", async () => {
    m.rpc.mockResolvedValue({
      data: [
        {
          id: ID,
          question: "Q",
          answer: "A",
          category: "General",
          sort_order: 1,
          published: false,
          updated_at: "2026-10-19T00:00:00Z",
        },
      ],
      error: null,
    });
    const res = await listFaqsHandler();
    expect(m.requireStaff).toHaveBeenCalledWith("faq.manage");
    expect(m.rpc).toHaveBeenCalledWith("faq_list", { p_actor: ME });
    expect(res).toMatchObject({
      ok: true,
      faqs: [{ id: ID, sortOrder: 1, published: false, updatedAt: "2026-10-19T00:00:00Z" }],
    });
  });

  it("saves a new entry with every field, trimmed, category defaulted", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await expect(saveFaqHandler(GOOD)).resolves.toEqual({ ok: true, id: ID });
    expect(m.requireStaff).toHaveBeenCalledWith("faq.manage");
    expect(m.rpc).toHaveBeenCalledWith("faq_save", {
      p_actor: ME,
      p_entry: {
        question: "How do I reset my PIN?",
        answer: "Open Settings.",
        category: "General",
        sort_order: 2,
        published: true,
      },
    });
  });

  it("sends the id when editing", async () => {
    m.rpc.mockResolvedValue({ data: ID, error: null });
    await saveFaqHandler({ ...GOOD, id: ID });
    expect(m.rpc.mock.calls[0]?.[1].p_entry.id).toBe(ID);
  });

  it("refuses bad input before any I/O", async () => {
    const cases = [
      { ...GOOD, question: "  " },
      { ...GOOD, question: "x".repeat(201) },
      { ...GOOD, answer: "" },
      { ...GOOD, answer: "x".repeat(4001) },
      { ...GOOD, category: "x".repeat(41) },
      { ...GOOD, sortOrder: 1.5 },
      { ...GOOD, id: "nope" },
    ];
    for (const c of cases) {
      await expect(saveFaqHandler(c)).resolves.toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    await expect(deleteFaqHandler({ id: "nope" })).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(m.requireStaff).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("deletes through faq_delete", async () => {
    await expect(deleteFaqHandler({ id: ID })).resolves.toEqual({ ok: true });
    expect(m.requireStaff).toHaveBeenCalledWith("faq.manage");
    expect(m.rpc).toHaveBeenCalledWith("faq_delete", { p_actor: ME, p_id: ID });
  });

  it("a rule break is a conflict with its message", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "That question doesn't exist." },
    });
    await expect(deleteFaqHandler({ id: ID })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "That question doesn't exist.",
    });
  });

  it("a missing function says nothing about itself", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.faq_list" },
    });
    await expect(listFaqsHandler()).resolves.toMatchObject({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
  });

  it("020 not applied yet is on our side, logged once with the function's name", async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function public.faq_list(uuid) does not exist" },
    });
    await expect(listFaqsHandler()).resolves.toEqual({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
    expect(m.log).toHaveBeenCalledTimes(1);
    expect(m.log).toHaveBeenCalledWith("faq", expect.any(Error));
    expect((m.log.mock.calls[0]![1] as Error).message).toMatch(/^faq_list: function /);
  });

  it("a refused role never reaches the database", async () => {
    m.requireStaff.mockRejectedValue(new Error("no"));
    await expect(listFaqsHandler()).resolves.toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
