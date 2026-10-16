// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ activity: vi.fn(), exp: vi.fn(), download: vi.fn() }));
vi.mock("../crm.actions", () => ({
  addActivityFn: (...a: unknown[]) => m.activity(...a),
  exportContactsFn: (...a: unknown[]) => m.exp(...a),
}));
vi.mock("@/lib/csv", async (orig) => ({
  ...(await orig<typeof import("@/lib/csv")>()),
  downloadCsv: (...a: unknown[]) => m.download(...a),
}));
vi.mock("@/features/team/team.actions", () => ({
  listTeamNamesFn: async () => ({ ok: true, members: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { ExportDialog, LogActivityDialog } from "./crm-dialogs";

// input-otp measures itself and looks for password managers; jsdom has neither API.
document.elementFromPoint ??= () => null;
// jsdom has no ResizeObserver either.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LogActivityDialog (FR-CRM-7, NFR-5)", () => {
  it("defaults to the time the dialog opens, not the time the page loaded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T02:00:00Z"));
    m.activity.mockResolvedValue({ ok: true, id: "a1" });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LogActivityDialog
          name="Lia"
          contactRef={{ contactId: "c1" }}
          onSaved={() => {}}
          trigger={<button type="button">Log activity</button>}
        />
      </QueryClientProvider>,
    );

    // The admin takes a call hours later, then logs it.
    vi.setSystemTime(new Date("2026-10-15T06:30:00Z"));
    fireEvent.click(screen.getByRole("button", { name: "Log activity" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What was said"), { target: { value: "Hi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log activity" }));
    await waitFor(() => expect(m.activity).toHaveBeenCalled());
    const at = Date.parse(m.activity.mock.calls[0][0].data.occurredAt);
    // Minutes precision: within a minute of when the dialog opened.
    expect(Math.abs(at - Date.parse("2026-10-15T06:30:00Z"))).toBeLessThan(60_000);
  });
});

describe("ExportDialog (FR-CRM-11, S-5, S-18)", () => {
  function renderExport(onOpenChange = vi.fn()) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ExportDialog open onOpenChange={onOpenChange} filters={{ kind: "lead" }} />
      </QueryClientProvider>,
    );
    return onOpenChange;
  }

  it("export asks for the code and downloads the file", async () => {
    m.exp.mockResolvedValue({
      ok: true,
      rows: [
        {
          contactId: "c1",
          kind: "lead",
          stage: "new",
          fullName: "Lia Santos",
          email: "lia@example.com",
          phone: null,
          source: "facebook",
          ownerId: null,
          tags: ["OFW"],
          createdAt: "2026-10-01T00:00:00Z",
        },
      ],
    });
    const onOpenChange = renderExport();
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Export with contact details" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(m.exp).toHaveBeenCalledWith({ data: { filters: { kind: "lead" }, code: "123456" } }),
    );
    await waitFor(() => expect(m.download).toHaveBeenCalled());
    const [filename, csv] = m.download.mock.calls[0];
    expect(filename).toMatch(/^linara-crm-contacts-with-details-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split("\r\n")[0]).toBe(
      "contact_id,kind,stage,full_name,email,phone,source,owner_id,tags,created",
    );
    expect(csv).toContain("lia@example.com");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("a wrong code keeps the dialog open with the message", async () => {
    m.exp.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "That code didn't work. Check your authenticator app and try again.",
    });
    m.download.mockReset();
    renderExport();
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export with contact details" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That code didn't work.");
    expect(m.download).not.toHaveBeenCalled();
  });
});
