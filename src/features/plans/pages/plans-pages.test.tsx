// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

// jsdom lacks what Radix Select calls when it opens.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= vi.fn();

import { dispatchCatalog, resetCatalog } from "../plans.store";
import { PlanPage } from "./plan-page";
import { PlansPage } from "./plans-page";
import { SwitchesPage } from "./switches-page";

afterEach(() => {
  cleanup();
  act(() => resetCatalog());
  navigate.mockReset();
});

const table = (name: string) => within(screen.getByRole("table", { name }));
const dialog = () => within(screen.getByRole("dialog"));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("PlansPage (D47)", () => {
  it("says it is sample data and lists the plans in order", () => {
    render(<PlansPage />);
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    const names = table("Plans")
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual(["Free", "Normal", "Premium"]);
    // Normal and Premium carry placeholder prices; household counts come from the subscriptions.
    expect(table("Plans").getAllByText("Placeholder price")).toHaveLength(2);
    const free = table("Plans").getByText("Free").closest("tr")!;
    expect(within(free).getByText("1 household")).toBeInTheDocument();
  });

  it("reorders, and the ends can't move further", () => {
    render(<PlansPage />);
    expect(screen.getByRole("button", { name: "Move Free up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Premium down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Premium up" }));
    const names = table("Plans")
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual(["Free", "Premium", "Normal"]);
  });

  it("points at the switch that turns Staff pay & HR off for everyone", () => {
    render(<PlansPage />);
    expect(screen.getByRole("link", { name: "Staff pay & HR" })).toHaveAttribute(
      "href",
      "/switches",
    );
  });

  it("won't offer an add-on without a price, and refuses a malformed one", async () => {
    render(<PlansPage />);
    const row = table("Add-ons").getByText("Extra co-manager").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    type(dialog().getByLabelText(/Price a month/), "1.234");
    expect(dialog().getByRole("button", { name: "Save add-on" })).toBeDisabled();
    type(dialog().getByLabelText(/Price a month/), "");
    fireEvent.click(dialog().getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Offered to households" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Save add-on" }));
    });
    expect(dialog().getByRole("alert")).toHaveTextContent(/Set a price before offering it/);
  });

  it("creates a draft and opens it", async () => {
    render(<PlansPage />);
    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    type(dialog().getByLabelText("Name"), "Family plus");
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Create draft" }));
    });
    expect(navigate).toHaveBeenCalledWith({
      to: "/plans/$planId",
      params: { planId: "family-plus" },
    });
    expect(table("Plans").getByText("Family plus")).toBeInTheDocument();
  });

  it("refuses a second plan with a name already used, whatever the case", async () => {
    render(<PlansPage />);
    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    type(dialog().getByLabelText("Name"), "  premium ");
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Create draft" }));
    });
    expect(dialog().getByRole("alert")).toHaveTextContent(/already has this name/);
    expect(navigate).not.toHaveBeenCalled();
  });
});

/** Every sample plan is published, so draft cases start from a new one. */
function newDraft() {
  act(() => {
    dispatchCatalog({ type: "create_plan", id: "family", name: "Family" });
  });
}

describe("PlanPage (D47)", () => {
  it("won't publish a draft while it has no price", async () => {
    newDraft();
    render(<PlanPage planId="family" />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Publish" }));
    });
    expect(dialog().getByRole("alert")).toHaveTextContent(/Set at least one price/);
  });

  it("flags a malformed price and won't save it", () => {
    newDraft();
    render(<PlanPage planId="family" />);
    fireEvent.click(screen.getByLabelText("Sold monthly"));
    const price = screen.getByLabelText("Monthly price in pesos");
    type(price, "12.345");
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/like 199 or 1,299.50/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("saves a price, then publishes as version 1", async () => {
    newDraft();
    render(<PlanPage planId="family" />);
    fireEvent.click(screen.getByLabelText("Sold monthly"));
    type(screen.getByLabelText("Monthly price in pesos"), "199");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Publish" }));
    });
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Version 1").length).toBeGreaterThan(0);
  });

  it("a change to a published plan saves as the next version, and Discard puts it back", () => {
    render(<PlanPage planId="free" />);
    const kasambahay = screen.getByLabelText("Kasambahay");
    type(kasambahay, "2");
    expect(screen.getByText(/The 1 household on version 1 keeps it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Kasambahay")).toHaveValue("1");
    type(screen.getByLabelText("Kasambahay"), "2");
    fireEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    // In the publishing panel and at the top of the history.
    expect(screen.getAllByText("Version 2")).toHaveLength(2);
    expect(screen.getByText(/Changed limits, by You/)).toBeInTheDocument();
  });

  it("blocks status changes while there are unsaved edits", () => {
    render(<PlanPage planId="free" />);
    type(screen.getByLabelText("Name"), "Free forever");
    expect(screen.getByRole("button", { name: "Hide from sign-up" })).toBeDisabled();
    expect(screen.getByText("Save or discard your changes first.")).toBeInTheDocument();
  });

  it("refuses a limit that isn't a whole number in range", () => {
    render(<PlanPage planId="free" />);
    for (const bad of ["-1", "1.5", "abc", "0", "100"]) {
      type(screen.getByLabelText("Households"), bad);
      expect(screen.getByLabelText("Households")).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("says the sample prices are placeholders", () => {
    render(<PlanPage planId="normal" />);
    expect(
      screen.getByText(/placeholder prices until marketing sets the real ones/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === "3 households are on this plan.",
      ),
    ).toBeInTheDocument();
  });

  it("says when the plan doesn't exist", () => {
    render(<PlanPage planId="nope" />);
    expect(screen.getByText("This plan isn't in the catalog")).toBeInTheDocument();
  });
});

describe("SwitchesPage (D47)", () => {
  it("shows Staff pay & HR off, and turning it on needs a reason", async () => {
    render(<SwitchesPage />);
    expect(screen.getAllByText("Off for everyone").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Turn on Staff pay & HR" }));
    expect(dialog().getByText("This turns on:")).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Turn on" })).toBeDisabled();
    type(dialog().getByLabelText("Why"), "   ");
    expect(dialog().getByRole("button", { name: "Turn on" })).toBeDisabled();
    type(dialog().getByLabelText("Why"), "Cleared by legal");
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Turn on" }));
    });
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Turned on")).toBeInTheDocument();
    expect(screen.getByText("Cleared by legal")).toBeInTheDocument();
  });

  it("lists the plans that include it", () => {
    render(<SwitchesPage />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute("href", "/plans/premium");
    expect(screen.queryByRole("link", { name: "Free" })).toBeNull();
  });
});
