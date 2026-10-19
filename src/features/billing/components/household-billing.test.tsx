// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asRole } from "@/features/auth/staff.test-utils";
import { examplePlan } from "@/features/plans/plans.test-utils";

import type { HouseholdBilling } from "../billing.types";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  grant: vi.fn(),
  markPaid: vi.fn(),
  revoke: vi.fn(),
  plans: vi.fn(),
}));
vi.mock("../billing.actions", () => ({
  getHouseholdBillingFn: (...a: unknown[]) => m.get(...a),
  grantPlanFn: (...a: unknown[]) => m.grant(...a),
  markInvoicePaidFn: (...a: unknown[]) => m.markPaid(...a),
  revokeSubscriptionFn: (...a: unknown[]) => m.revoke(...a),
}));
vi.mock("@/features/plans/plans.actions", () => ({
  listPlansFn: (...a: unknown[]) => m.plans(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Radix Select needs pointer APIs jsdom lacks; a native select keeps the same contract.
vi.mock("@/components/shared/form", async (orig) => {
  const actual = await orig<typeof import("@/components/shared/form")>();
  return {
    ...actual,
    SelectField: (p: {
      id: string;
      value: string;
      onChange: (v: string) => void;
      options: { value: string; label: string }[];
    }) => (
      <select id={p.id} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
        <option value="">Choose</option>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
  };
});

// input-otp measures itself and looks for password managers; jsdom has neither API.
document.elementFromPoint ??= () => null;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { HouseholdBillingSection } from "./household-billing";

const HOME = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
const PLAN = "7f0c2a7e-1b2c-4d5e-8f90-0000000000a1";
const OLD = "7f0c2a7e-1b2c-4d5e-8f90-0000000000a2";
const INVOICE = "7f0c2a7e-1b2c-4d5e-8f90-0000000000b1";

const BILLING: HouseholdBilling = {
  entitlements: {
    source: "subscription",
    subscriptionId: "s1",
    planName: "Family",
    status: "active",
    effectiveStatus: "active",
    helperSeats: 3,
    managerSeats: null,
    periodEnd: "2026-12-01T00:00:00Z",
    daysLeft: 40,
  },
  subscriptions: [
    {
      id: "s1",
      planName: "Family",
      interval: "monthly",
      status: "active",
      helperSeats: 3,
      managerSeats: null,
      homeSeats: 1,
      amountCentavos: 49900,
      currentPeriodStart: "2026-11-01T00:00:00Z",
      currentPeriodEnd: "2026-12-01T00:00:00Z",
      canceledAt: null,
      note: null,
      createdAt: "2026-11-01T00:00:00Z",
      revoked: false,
    },
  ],
  invoices: [
    {
      id: INVOICE,
      invoiceNumber: "LIN-2026-000007",
      subscriptionId: "s1",
      status: "pending",
      amountCentavos: 49900,
      currency: "PHP",
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: null,
      paidAt: null,
      paidChannel: null,
      createdAt: "2026-11-02T00:00:00Z",
    },
  ],
  homes: [{ id: HOME, name: "Santos" }],
  usage: { helpers: 2, managers: 1 },
  notes: [],
};

function renderSection(permissions: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Role = asRole(permissions);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Role>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Role>
  );
  return render(<HouseholdBillingSection householdId={HOME} />, { wrapper });
}

const VIEW = ["billing.view"];
const MANAGE = ["billing.view", "billing.manage"];

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.get.mockResolvedValue({ ok: true, billing: BILLING });
  m.grant.mockResolvedValue({ ok: true, subscriptionId: "s9", invoiceId: "i9" });
  m.markPaid.mockResolvedValue({ ok: true, applied: true });
  m.revoke.mockResolvedValue({ ok: true });
  m.plans.mockResolvedValue({
    ok: true,
    plans: [
      examplePlan({ id: OLD, name: "Legacy", status: "archived" }),
      examplePlan({ id: "draft", name: "Secret", status: "draft" }),
      examplePlan({ id: PLAN, name: "Family", status: "active" }),
    ],
  });
  vi.mocked(toast.success).mockReset();
});
afterEach(cleanup);

async function openDialogAndSubmit(
  openName: string | RegExp,
  fill: (dialog: HTMLElement) => void,
  submitName: string,
) {
  fireEvent.click(await screen.findByRole("button", { name: openName }));
  const dialog = await screen.findByRole("dialog");
  fill(dialog);
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Because" } });
  fireEvent.change(within(dialog).getByLabelText("Your two-step code"), {
    target: { value: "123456" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: submitName }));
}

describe("Plan & billing section", () => {
  it("shows the plan, status, period, seats against usage and the pending invoice", async () => {
    renderSection(MANAGE);
    expect(await screen.findByText("Family, monthly")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Until/)).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByText("1 of unlimited")).toBeInTheDocument();
    expect(screen.getByText(/LIN-2026-000007, ₱499\.00, created/)).toBeInTheDocument();
  });

  it("hides the actions without billing.manage, and the panel without billing.view", async () => {
    const { unmount } = renderSection(VIEW);
    expect(await screen.findByText("Family, monthly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Grant plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark paid/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke plan" })).toBeNull();
    unmount();
    m.get.mockClear();
    renderSection(["households.view"]);
    expect(screen.queryByText("Plan & billing")).toBeNull();
    expect(m.get).not.toHaveBeenCalled();
  });

  it("names the free tier and a household with no plan", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        invoices: [],
        entitlements: {
          ...BILLING.entitlements,
          source: "free",
          effectiveStatus: null,
          planName: null,
        },
      },
    });
    renderSection(VIEW);
    expect(await screen.findByText("Free tier")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("says the figures didn't load", async () => {
    m.get.mockResolvedValue({ ok: false, code: "outside_service", message: "Went wrong." });
    renderSection(MANAGE);
    expect(await screen.findByText("Billing figures didn't load")).toBeInTheDocument();
  });

  it("grant sends nulls for Unlimited seats and a blank end date", async () => {
    renderSection(MANAGE);
    await openDialogAndSubmit(
      "Grant plan",
      (dialog) => {
        const select = within(dialog).getByLabelText("Plan");
        expect(within(select).queryByText("Secret")).toBeNull();
        expect(within(select).getByText("Legacy (archived)")).toBeInTheDocument();
        fireEvent.change(select, { target: { value: PLAN } });
        const [helpersUnlimited, managersUnlimited] = within(dialog).getAllByRole("checkbox");
        fireEvent.click(helpersUnlimited!);
        fireEvent.click(managersUnlimited!);
      },
      "Grant plan",
    );
    await waitFor(() => expect(m.grant).toHaveBeenCalledTimes(1));
    expect(m.grant).toHaveBeenCalledWith({
      data: {
        householdId: HOME,
        planId: PLAN,
        helperSeats: null,
        managerSeats: null,
        periodEnd: null,
        note: "",
        reason: "Because",
        code: "123456",
      },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan granted"));
  });

  it("grant sends typed seats and the chosen end date", async () => {
    renderSection(MANAGE);
    await openDialogAndSubmit(
      "Grant plan",
      (dialog) => {
        fireEvent.change(within(dialog).getByLabelText("Plan"), { target: { value: PLAN } });
        fireEvent.change(within(dialog).getByLabelText("Helper seats"), { target: { value: "4" } });
        fireEvent.change(within(dialog).getByLabelText("Manager seats"), {
          target: { value: "0" },
        });
        fireEvent.change(within(dialog).getByLabelText("Period end"), {
          target: { value: "2027-03-31" },
        });
      },
      "Grant plan",
    );
    await waitFor(() => expect(m.grant).toHaveBeenCalledTimes(1));
    expect(m.grant).toHaveBeenCalledWith({
      data: expect.objectContaining({ helperSeats: 4, managerSeats: 0, periodEnd: "2027-03-31" }),
    });
  });

  it("mark paid says it marked the invoice paid", async () => {
    renderSection(MANAGE);
    await openDialogAndSubmit(
      /^Mark paids*LIN-2026-000007$/,
      (dialog) => {
        expect(within(dialog).getByText(/₱499\.00 received/)).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText("How it was paid"), {
          target: { value: "gcash" },
        });
      },
      "Mark paid",
    );
    await waitFor(() => expect(m.markPaid).toHaveBeenCalledTimes(1));
    expect(m.markPaid).toHaveBeenCalledWith({
      data: { invoiceId: INVOICE, channel: "gcash", note: "", reason: "Because", code: "123456" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Marked paid"));
  });

  it("mark paid with applied false says nothing changed", async () => {
    m.markPaid.mockResolvedValue({ ok: true, applied: false });
    renderSection(MANAGE);
    await openDialogAndSubmit(
      /^Mark paids*LIN-2026-000007$/,
      (dialog) =>
        fireEvent.change(within(dialog).getByLabelText("How it was paid"), {
          target: { value: "cash" },
        }),
      "Mark paid",
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "That invoice was already paid or expired, so nothing changed.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Marked paid");
  });

  it("notes render, with Needs attention when one mentions a refund", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        notes: [
          { subscriptionId: "s1", status: "active", note: "Paid twice: check Xendit and refund." },
          { subscriptionId: "s1", status: "active", note: "Comped for the pilot." },
        ],
      },
    });
    renderSection(VIEW);
    expect(await screen.findByText("Paid twice: check Xendit and refund.")).toBeInTheDocument();
    expect(screen.getByText("Comped for the pilot.")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("a payment to check in Xendit also needs attention", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        notes: [
          {
            subscriptionId: "s1",
            status: "past_due",
            note: "Paid ₱400.00 for an invoice of ₱499.00; check in Xendit",
          },
        ],
      },
    });
    renderSection(VIEW);
    expect(await screen.findByText(/check in Xendit/)).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("no refund note means no Needs attention chip", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        notes: [{ subscriptionId: "s1", status: "active", note: "Comped for the pilot." }],
      },
    });
    renderSection(VIEW);
    expect(await screen.findByText("Comped for the pilot.")).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).toBeNull();
  });
});

const invoice = (
  id: string,
  invoiceNumber: string,
  status: HouseholdBilling["invoices"][number]["status"],
  subscriptionId = "s1",
): HouseholdBilling["invoices"][number] => ({
  ...BILLING.invoices[0]!,
  id,
  invoiceNumber,
  status,
  subscriptionId,
});

describe("unpaid invoices", () => {
  it("lists pending, expired and failed invoices of a running plan with Mark paid, never paid ones", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        invoices: [
          invoice("i1", "LIN-2026-000011", "pending"),
          invoice("i2", "LIN-2026-000012", "expired"),
          invoice("i3", "LIN-2026-000013", "failed"),
          invoice("i4", "LIN-2026-000014", "paid"),
        ],
      },
    });
    renderSection(MANAGE);
    expect(await screen.findByText("Waiting to be paid")).toBeInTheDocument();
    expect(screen.getByText("Expired, not paid")).toBeInTheDocument();
    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    for (const name of [
      /^Mark paid\s*LIN-2026-000011$/,
      /^Mark paid\s*LIN-2026-000012$/,
      /^Mark paid\s*LIN-2026-000013$/,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/LIN-2026-000014/)).toBeNull();
  });

  it("an expired invoice is marked paid like a pending one", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: { ...BILLING, invoices: [invoice(INVOICE, "LIN-2026-000012", "expired")] },
    });
    renderSection(MANAGE);
    await openDialogAndSubmit(
      /^Mark paids*LIN-2026-000012$/,
      (dialog) =>
        fireEvent.change(within(dialog).getByLabelText("How it was paid"), {
          target: { value: "bank_transfer" },
        }),
      "Mark paid",
    );
    await waitFor(() =>
      expect(m.markPaid).toHaveBeenCalledWith({
        data: expect.objectContaining({ invoiceId: INVOICE, channel: "bank_transfer" }),
      }),
    );
  });

  it("lists nothing to pay for a plan the household canceled or staff revoked", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        subscriptions: [
          { ...BILLING.subscriptions[0]!, status: "canceled" },
          { ...BILLING.subscriptions[0]!, id: "s2", status: "canceled", revoked: true },
        ],
        invoices: [
          invoice("i1", "LIN-2026-000021", "pending", "s1"),
          invoice("i2", "LIN-2026-000022", "expired", "s1"),
          invoice("i3", "LIN-2026-000023", "pending", "s2"),
        ],
      },
    });
    renderSection(MANAGE);
    expect(await screen.findByText("Family, monthly")).toBeInTheDocument();
    expect(screen.queryByText("Waiting to be paid")).toBeNull();
    expect(screen.queryByText("Expired, not paid")).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark paid/ })).toBeNull();
  });
});

describe("revoking a plan", () => {
  it("says quietly that Linara support revoked a plan", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        entitlements: {
          ...BILLING.entitlements,
          source: "free",
          subscriptionId: null,
          effectiveStatus: null,
          planName: null,
        },
        subscriptions: [
          { ...BILLING.subscriptions[0]!, planName: "Pilot", status: "canceled", revoked: true },
        ],
        invoices: [],
      },
    });
    renderSection(MANAGE);
    expect(await screen.findByText("Pilot: Revoked by Linara support")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke plan" })).toBeNull();
  });

  it("revokes the current plan with a reason and the code", async () => {
    renderSection(MANAGE);
    await openDialogAndSubmit("Revoke plan", () => undefined, "Revoke plan");
    await waitFor(() => expect(m.revoke).toHaveBeenCalledTimes(1));
    expect(m.revoke).toHaveBeenCalledWith({
      data: { subscriptionId: "s1", reason: "Because", code: "123456" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan revoked"));
    await waitFor(() => expect(m.get).toHaveBeenCalledTimes(2));
  });

  it("is offered for a canceled current plan too, and shows a refusal", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        entitlements: { ...BILLING.entitlements, status: "canceled", effectiveStatus: "canceled" },
        subscriptions: [{ ...BILLING.subscriptions[0]!, status: "canceled" }],
      },
    });
    m.revoke.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "That subscription is already revoked.",
    });
    renderSection(MANAGE);
    await openDialogAndSubmit("Revoke plan", () => undefined, "Revoke plan");
    expect(await screen.findByText("That subscription is already revoked.")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalledWith("Plan revoked");
  });

  it("isn't offered when the household has no plan of its own", async () => {
    m.get.mockResolvedValue({
      ok: true,
      billing: {
        ...BILLING,
        entitlements: {
          ...BILLING.entitlements,
          source: "free",
          subscriptionId: null,
          effectiveStatus: null,
          planName: null,
        },
        subscriptions: [],
        invoices: [],
      },
    });
    renderSection(MANAGE);
    expect(await screen.findByText("Free tier")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke plan" })).toBeNull();
  });
});

describe("grant seats", () => {
  it("over 1000 seats can't be granted (billing_grant's limit)", async () => {
    renderSection(MANAGE);
    fireEvent.click(await screen.findByRole("button", { name: "Grant plan" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Plan"), { target: { value: PLAN } });
    fireEvent.change(within(dialog).getByLabelText("Helper seats"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("Manager seats"), { target: { value: "1000" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Because" } });
    fireEvent.change(within(dialog).getByLabelText("Your two-step code"), {
      target: { value: "123456" },
    });
    expect(within(dialog).getByRole("button", { name: "Grant plan" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Helper seats"), { target: { value: "1000" } });
    expect(within(dialog).getByRole("button", { name: "Grant plan" })).toBeEnabled();
    expect(within(dialog).getAllByText("0 to 1000.")).toHaveLength(2);
  });
});
