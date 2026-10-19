// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asRole } from "@/features/auth/staff.test-utils";
import { toast } from "sonner";

import type { FaqEntry } from "../faq.types";

const m = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), del: vi.fn() }));
vi.mock("../faq.actions", () => ({
  listFaqsFn: (...a: unknown[]) => m.list(...a),
  saveFaqFn: (...a: unknown[]) => m.save(...a),
  deleteFaqFn: (...a: unknown[]) => m.del(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FaqsPage } from "./faqs-page";

const entry = (
  id: string,
  question: string,
  category: string,
  sortOrder: number,
  published: boolean,
): FaqEntry => ({
  id,
  question,
  answer: `Answer to ${question}`,
  category,
  sortOrder,
  published,
  updatedAt: "2026-10-19T00:00:00Z",
});
const FAQS = [
  entry("f1", "How do I pay a helper?", "Pay", 1, true),
  entry("f2", "What is a Pass?", "General", 2, false),
  entry("f3", "What is Linara?", "General", 1, true),
];

function renderPage() {
  const Role = asRole(["faq.manage"]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Role>{children}</Role>
    </QueryClientProvider>
  );
  return render(<FaqsPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  m.list.mockReset().mockResolvedValue({ ok: true, faqs: FAQS });
  m.save.mockReset().mockResolvedValue({ ok: true, id: "f2" });
  m.del.mockReset().mockResolvedValue({ ok: true });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(cleanup);

describe("FaqsPage", () => {
  it("groups rows by category with a status chip and order", async () => {
    renderPage();
    const general = (await screen.findByRole("heading", { name: "General" })).closest("section")!;
    const rows = within(general).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("What is Linara?");
    expect(rows[0]).toHaveTextContent("Published");
    expect(rows[1]).toHaveTextContent("What is a Pass?");
    expect(rows[1]).toHaveTextContent("Draft");
    expect(rows[1]).toHaveTextContent("Order 2");
    const pay = screen.getByRole("heading", { name: "Pay" }).closest("section")!;
    expect(within(pay).getAllByRole("listitem")).toHaveLength(1);
  });

  it("publishes inline and toasts only after the write settles", async () => {
    let settle: (v: unknown) => void = () => {};
    m.save.mockReturnValue(new Promise((r) => (settle = r)));
    renderPage();
    const row = (await screen.findByText("What is a Pass?")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(m.save).toHaveBeenCalled());
    expect(m.save.mock.calls[0]?.[0].data).toMatchObject({ id: "f2", published: true });
    expect(toast.success).not.toHaveBeenCalled();
    settle({ ok: true, id: "f2" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("FAQ published"));
  });

  it("does not toast success when the write is refused", async () => {
    m.save.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "That question doesn't exist.",
    });
    renderPage();
    const row = (await screen.findByText("What is Linara?")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That question doesn't exist."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("asks before deleting and names the question", async () => {
    renderPage();
    const row = (await screen.findByText("What is a Pass?")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("What is a Pass?");
    expect(m.del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete FAQ" }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith({ data: { id: "f2" } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("FAQ deleted"));
  });

  it("shows the empty state", async () => {
    m.list.mockResolvedValue({ ok: true, faqs: [] });
    renderPage();
    expect(await screen.findByText("No FAQs yet")).toBeInTheDocument();
  });

  it("shows the didn't-load copy when the read is refused", async () => {
    m.list.mockResolvedValue({
      ok: false,
      code: "outside_service",
      message: "Something went wrong on our side. Try again.",
    });
    renderPage();
    expect(await screen.findByText("The FAQs didn't load")).toBeInTheDocument();
    expect(screen.queryByText("No FAQs yet")).not.toBeInTheDocument();
  });

  it("shows the didn't-load copy when the call throws", async () => {
    m.list.mockRejectedValue(new Error("network"));
    renderPage();
    expect(await screen.findByText("The FAQs didn't load")).toBeInTheDocument();
  });
});
