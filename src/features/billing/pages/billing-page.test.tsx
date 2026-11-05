// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// jsdom lacks what Radix Select calls when it opens.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= vi.fn();

import { dispatchCatalog, resetCatalog } from "@/features/plans/plans.store";

import { BillingPage } from "./billing-page";

// The sample, settled: before the first read answers the screens show a skeleton instead.
beforeEach(() => {
  act(() => resetCatalog());
});
afterEach(() => {
  cleanup();
  act(() => resetCatalog());
});

const table = (name: string) => within(screen.getAllByRole("table", { name })[0]);
const dialogs = () => screen.getAllByRole("dialog");
const top = () => within(dialogs()[dialogs().length - 1]);

function openSubscription(name: string) {
  fireEvent.click(table("Subscriptions").getByRole("button", { name }));
  fireEvent.click(top().getByRole("button", { name: "Change plan" }));
}

describe("BillingPage (D40, D47)", () => {
  it("says it is sample data and links to the plans", () => {
    render(<BillingPage />);
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText(/nothing here charges, refunds or saves/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute("href", "/plans");
    expect(screen.queryByRole("radio", { name: /^Plans/ })).toBeNull();
  });

  it("shows each subscription on the catalog's plans, with add-ons and the price it pays", () => {
    render(<BillingPage />);
    const row = table("Subscriptions").getByText("Reyes home, Mandaluyong").closest("tr")!;
    expect(within(row).getByText("Premium, yearly")).toBeInTheDocument();
    expect(within(row).getByText("Extra household × 1")).toBeInTheDocument();
    expect(within(row).getByText("₱5,190 a year")).toBeInTheDocument();
  });

  it("lists subscriptions and filters by status", () => {
    render(<BillingPage />);
    expect(table("Subscriptions").getByText("Santos home, Quezon City")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Past due/ }));
    expect(table("Subscriptions").getByText("Dizon home, Makati")).toBeInTheDocument();
    expect(table("Subscriptions").queryByText("Santos home, Quezon City")).toBeNull();
  });

  it("a summary figure opens its filtered list", () => {
    render(<BillingPage />);
    fireEvent.click(screen.getByRole("button", { name: /On trial/ }));
    expect(table("Subscriptions").getByText("Aquino residence, Davao")).toBeInTheDocument();
    expect(table("Subscriptions").queryByText("Dizon home, Makati")).toBeNull();
  });

  it("retrying a failed payment marks it paid", async () => {
    render(<BillingPage />);
    fireEvent.click(screen.getByRole("radio", { name: /^Payments/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Failed/ }));
    fireEvent.click(table("Payments").getByRole("button", { name: "Retry payment" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry payment" }));
    });
    expect(await screen.findByText("No payments match")).toBeInTheDocument();
  });

  it("search narrows by household or payer", () => {
    render(<BillingPage />);
    fireEvent.change(screen.getByPlaceholderText("Search by household or payer"), {
      target: { value: "ramon" },
    });
    expect(table("Subscriptions").getByText("Mercado household, Cebu City")).toBeInTheDocument();
    expect(table("Subscriptions").queryByText("Santos home, Quezon City")).toBeNull();
  });

  it("changing plan prices add-ons live and refuses a bad quantity", () => {
    render(<BillingPage />);
    openSubscription("Santos home, Quezon City");
    expect(top().getByText("New price: ₱249 a month")).toBeInTheDocument();
    const qty = top().getByLabelText(/Extra kasambahay/);
    fireEvent.change(qty, { target: { value: "3" } });
    expect(top().getByText("New price: ₱349 a month")).toBeInTheDocument();
    for (const bad of ["11", "-1", "1.5", "x"]) {
      fireEvent.change(qty, { target: { value: bad } });
      expect(top().getByText(/Add 0 to 10 of each add-on/)).toBeInTheDocument();
      expect(top().getByRole("button", { name: "Change plan" })).toBeDisabled();
    }
  });

  it("submitting the plan it already has is refused, not charged again", async () => {
    render(<BillingPage />);
    openSubscription("Santos home, Quezon City");
    await act(async () => {
      fireEvent.click(top().getByRole("button", { name: "Change plan" }));
    });
    expect(top().getByRole("alert")).toHaveTextContent(/already has/);
  });

  it("offers only published plans: a plan hidden on the Plans screen disappears here", async () => {
    act(() => {
      dispatchCatalog({ type: "set_status", planId: "premium", status: "hidden" });
    });
    render(<BillingPage />);
    openSubscription("Gonzales home, Pasig");
    fireEvent.click(top().getAllByRole("combobox")[0]);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Free", "Normal"]);
  });
});
