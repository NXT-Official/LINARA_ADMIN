// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ dupes: vi.fn(), imp: vi.fn(), navigate: vi.fn() }));
vi.mock("../crm.actions", () => ({
  findDuplicatesFn: (...a: unknown[]) => m.dupes(...a),
  importLeadsFn: (...a: unknown[]) => m.imp(...a),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => m.navigate }));
vi.mock("@/components/shared/links", () => ({
  BackLink: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { ImportPage } from "./import-page";

const CSV =
  "Name,Email,Phone,Notes\r\n" +
  "Lia Santos,lia@example.com,,Met at expo\r\n" +
  "Paolo Cruz,,,\r\n" +
  "Nina Ramos,nina@example.com,0918 111 2222,\r\n";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportPage />
    </QueryClientProvider>,
  );
}

async function chooseFile(text = CSV) {
  const file = new File([text], "leads.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
  await screen.findByLabelText("Name column");
}

async function toPreview(text = CSV) {
  renderPage();
  await chooseFile(text);
  fireEvent.change(screen.getByLabelText("How these people agreed to be contacted"), {
    target: { value: "Signed up for updates at the Makati home expo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check rows" }));
  await screen.findByRole("table");
}

beforeEach(() => {
  m.dupes.mockReset().mockResolvedValue({ ok: true, matches: [] });
  m.imp.mockReset().mockResolvedValue({ ok: true, imported: 2 });
  m.navigate.mockReset();
});
afterEach(cleanup);

describe("ImportPage (FR-CRM-10, S-24)", () => {
  it("reads a file and guesses the columns", async () => {
    renderPage();
    await chooseFile();
    expect(screen.getByLabelText("Name column")).toHaveValue("0");
    expect(screen.getByLabelText("Email column")).toHaveValue("1");
    expect(screen.getByLabelText("Phone column")).toHaveValue("2");
    expect(screen.getByLabelText("Notes column")).toHaveValue("3");
    expect(screen.getByLabelText("Source column")).toHaveValue("");
    expect(screen.getByText(/3 rows in leads\.csv/)).toBeInTheDocument();
  });

  it("consent basis is required", async () => {
    renderPage();
    await chooseFile();
    expect(screen.getByRole("button", { name: "Check rows" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("How these people agreed to be contacted"), {
      target: { value: "At the expo" },
    });
    expect(screen.getByRole("button", { name: "Check rows" })).toBeEnabled();
  });

  it("duplicates start excluded and can be included", async () => {
    m.dupes.mockResolvedValue({ ok: true, matches: [{ email: "nina@example.com", phone: null }] });
    await toPreview();
    expect(m.dupes).toHaveBeenCalledWith({
      data: { emails: ["lia@example.com", "nina@example.com"], phones: ["0918 111 2222"] },
    });
    const nina = screen.getByRole("checkbox", { name: "Include line 4" });
    expect(nina).not.toBeChecked();
    expect(screen.getByText("Already in the CRM")).toBeInTheDocument();
    fireEvent.click(nina);
    expect(nina).toBeChecked();
  });

  it("a bad included row blocks import and names its line", async () => {
    await toPreview();
    expect(screen.getByText("A lead needs an email or a phone number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled();
    expect(screen.getByText(/line 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include line 3" }));
    expect(screen.getByRole("button", { name: "Import 2 leads" })).toBeEnabled();
  });

  it("import posts the included rows and returns to the CRM", async () => {
    await toPreview();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include line 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 leads" }));
    await waitFor(() => expect(m.imp).toHaveBeenCalled());
    const sent = m.imp.mock.calls[0][0].data;
    expect(sent.consentBasis).toBe("Signed up for updates at the Makati home expo");
    expect(sent.rows.map((r: { fullName: string }) => r.fullName)).toEqual([
      "Lia Santos",
      "Nina Ramos",
    ]);
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith({ to: "/crm" }));
  });

  it("the server's refusal shows as a message", async () => {
    m.imp.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "Row 1: Enter a valid email.",
    });
    await toPreview();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include line 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 leads" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Row 1: Enter a valid email.");
    expect(m.navigate).not.toHaveBeenCalled();
  });
});
