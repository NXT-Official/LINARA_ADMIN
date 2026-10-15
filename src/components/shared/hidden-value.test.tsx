// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HiddenValue } from "./hidden-value";

afterEach(cleanup);

describe("HiddenValue (FR-US-6, S-17)", () => {
  it("fetches the value only when Show is clicked", async () => {
    const reveal = vi.fn().mockResolvedValue("₱18,000");
    render(<HiddenValue what="Carla's wage" reveal={reveal} />);
    expect(reveal).not.toHaveBeenCalled();
    expect(screen.queryByText("₱18,000")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Carla's wage" }));
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("₱18,000")).toBeInTheDocument();
  });

  it("says Not set for an empty value", async () => {
    render(<HiddenValue what="payout account" reveal={async () => null} />);
    fireEvent.click(screen.getByRole("button", { name: "Show payout account" }));
    expect(await screen.findByText("Not set")).toBeInTheDocument();
  });

  it("shows the server's message when the reveal fails, and can try again", async () => {
    const reveal = vi
      .fn()
      .mockRejectedValueOnce(new Error("Something went wrong on our side. Try again."))
      .mockResolvedValueOnce("₱18,000");
    render(<HiddenValue what="wage" reveal={reveal} />);
    fireEvent.click(screen.getByRole("button", { name: "Show wage" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong on our side. Try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show wage" }));
    expect(await screen.findByText("₱18,000")).toBeInTheDocument();
  });

  it("can't be clicked twice while loading", async () => {
    let finish: (v: string) => void = () => {};
    const reveal = vi.fn(() => new Promise<string>((r) => (finish = r)));
    render(<HiddenValue what="wage" reveal={reveal} />);
    const button = screen.getByRole("button", { name: "Show wage" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(reveal).toHaveBeenCalledTimes(1);
    finish("₱1");
    expect(await screen.findByText("₱1")).toBeInTheDocument();
  });
});
