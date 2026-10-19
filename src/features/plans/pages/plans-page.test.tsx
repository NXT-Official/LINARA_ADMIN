// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asRole } from "@/features/auth/staff.test-utils";

import { examplePlan } from "../plans.test-utils";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  settings: vi.fn(),
  save: vi.fn(),
  status: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock("../plans.actions", () => ({
  listPlansFn: (...a: unknown[]) => m.list(...a),
  getBillingSettingsFn: (...a: unknown[]) => m.settings(...a),
  savePlanFn: (...a: unknown[]) => m.save(...a),
  setPlanStatusFn: (...a: unknown[]) => m.status(...a),
  saveBillingSettingsFn: (...a: unknown[]) => m.saveSettings(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PlansPage } from "./plans-page";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const PLANS = [
  examplePlan({ id: ID, name: "Home", status: "draft", tagline: "For one household" }),
  examplePlan({ id: "p2", name: "Family", status: "active", isPublic: false, baseCentavos: 99900 }),
  examplePlan({ id: "p3", name: "Old", status: "archived" }),
];
const SETTINGS = {
  freeTierEnabled: true,
  freeHelperSeats: 1,
  freeManagerSeats: null,
  supportEmail: "help@linara.ph",
};

function renderPage(permissions: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Role = asRole(permissions);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Role>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Role>
  );
  return render(<PlansPage />, { wrapper });
}

const VIEW = ["billing.view"];
const MANAGE = ["billing.view", "billing.manage"];

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.list.mockResolvedValue({ ok: true, plans: PLANS });
  m.settings.mockResolvedValue({ ok: true, settings: SETTINGS });
  m.save.mockResolvedValue({ ok: true, planId: ID });
  m.status.mockResolvedValue({ ok: true });
  m.saveSettings.mockResolvedValue({ ok: true });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

describe("Plans page", () => {
  it("lists plans with the price sentence, status and public chips", async () => {
    renderPage(MANAGE);
    const list = await screen.findByRole("list", { name: "Plans" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Home")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Draft")).toBeInTheDocument();
    expect(
      within(items[0]!).getByText(
        "₱499.00 per month, 1 helper included, ₱99.00 per extra helper, 2 managers included",
      ),
    ).toBeInTheDocument();
    expect(within(items[0]!).getByText("Public")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Active")).toBeInTheDocument();
    expect(within(items[1]!).queryByText("Public")).toBeNull();
    expect(within(items[2]!).getByText("Archived")).toBeInTheDocument();
  });

  it("shows the free tier settings", async () => {
    renderPage(MANAGE);
    await screen.findByText("help@linara.ph");
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit free tier" })).toBeInTheDocument();
  });

  it("hides every manage action without billing.manage", async () => {
    renderPage(VIEW);
    await screen.findByText("Home");
    expect(screen.queryByRole("button", { name: "New plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Publish/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Archive/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Restore/ })).toBeNull();
  });

  it("offers each status only the moves the database allows", async () => {
    renderPage(MANAGE);
    await screen.findByText("Home");
    expect(screen.getByRole("button", { name: "Publish Home" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish Home" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unpublish Family" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive Family" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Old" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Old" })).toBeNull();
  });

  it("a status action calls the function, toasts and reloads the list", async () => {
    renderPage(MANAGE);
    await screen.findByText("Home");
    expect(m.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Publish Home" }));
    await waitFor(() =>
      expect(m.status).toHaveBeenCalledWith({ data: { planId: ID, status: "active" } }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan published"));
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
  });

  it("a refused move shows the database's sentence", async () => {
    m.status.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "A draft plan can't be moved to draft.",
    });
    renderPage(MANAGE);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Archive Family" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A draft plan can't be moved to draft."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("an empty list says so", async () => {
    m.list.mockResolvedValue({ ok: true, plans: [] });
    renderPage(MANAGE);
    expect(await screen.findByText("No plans yet")).toBeInTheDocument();
  });

  it("a failed load says so and can retry", async () => {
    m.list.mockResolvedValue({ ok: false, code: "outside_service", message: "Went wrong." });
    renderPage(MANAGE);
    expect(await screen.findByText("The plans didn't load")).toBeInTheDocument();
    expect(screen.getByText(/Went wrong\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
  });
});

describe("Plan dialog", () => {
  async function openNew() {
    renderPage(MANAGE);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    return screen.findByRole("dialog");
  }

  it("previews what a household with 2 helpers, 1 manager, 1 home pays", async () => {
    const dialog = await openNew();
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Fix the highlighted fields to see a price.",
    );
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Plus" } });
    fireEvent.change(within(dialog).getByLabelText("Base price (pesos)"), {
      target: { value: "499" },
    });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "A household with 2 helpers, 1 manager, 1 home can't buy this plan: there is no price for extra helpers.",
    );
    fireEvent.click(within(dialog).getByLabelText("Extra helpers not sold"));
    fireEvent.change(within(dialog).getByLabelText("Price per extra helper (pesos)"), {
      target: { value: "99" },
    });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "A household with 2 helpers, 1 manager, 1 home pays ₱598.00.",
    );
  });

  it("refuses pesos with more than two decimals", async () => {
    const dialog = await openNew();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Plus" } });
    fireEvent.change(within(dialog).getByLabelText("Base price (pesos)"), {
      target: { value: "1.234" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    expect(
      await within(dialog).findByText("Use pesos with up to two decimals"),
    ).toBeInTheDocument();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("saves a new plan as centavos with unlimited and not-sold as null", async () => {
    const dialog = await openNew();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " Plus " } });
    fireEvent.change(within(dialog).getByLabelText("Base price (pesos)"), {
      target: { value: "249.50" },
    });
    fireEvent.change(within(dialog).getByLabelText("What is included (one per line)"), {
      target: { value: "One\n\n Two " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        data: {
          name: "Plus",
          tagline: "",
          inclusions: ["One", "Two"],
          interval: "monthly",
          baseCentavos: 24950,
          includedHelpers: 1,
          includedManagers: 1,
          includedHomes: null,
          extraHelperCentavos: null,
          extraManagerCentavos: null,
          extraHomeCentavos: null,
          trialDays: 0,
          isPublic: true,
          sortOrder: 0,
        },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan created"));
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
  });

  it("editing keeps the id and starts from the saved values", async () => {
    renderPage(MANAGE);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Edit Home" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Home");
    expect(within(dialog).getByLabelText("Base price (pesos)")).toHaveValue("499.00");
    expect(within(dialog).getByLabelText("Unlimited homes")).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: ID, name: "Home", baseCentavos: 49900 }),
      }),
    );
  });
});

describe("Free tier dialog", () => {
  it("saves the switch, seats and support email", async () => {
    renderPage(MANAGE);
    await screen.findByText("help@linara.ph");
    fireEvent.click(screen.getByRole("button", { name: "Edit free tier" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Unlimited helpers"));
    fireEvent.click(within(dialog).getByLabelText("Unlimited managers"));
    fireEvent.change(within(dialog).getByLabelText("Free manager seats"), {
      target: { value: "2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save free tier" }));
    await waitFor(() =>
      expect(m.saveSettings).toHaveBeenCalledWith({
        data: {
          freeTierEnabled: true,
          freeHelperSeats: null,
          freeManagerSeats: 2,
          supportEmail: "help@linara.ph",
        },
      }),
    );
    await waitFor(() => expect(m.settings).toHaveBeenCalledTimes(2));
  });
});
