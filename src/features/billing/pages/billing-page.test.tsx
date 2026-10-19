// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BillingPage } from "./billing-page";

afterEach(cleanup);

const table = (name: string) => within(screen.getAllByRole("table", { name })[0]);

describe("BillingPage (D40)", () => {
  it("says it is sample data", () => {
    render(<BillingPage />);
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText(/nothing here charges, refunds or saves/)).toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry payment" }));
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
});
