// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import { RestrictedPanel } from "./states";

describe("RestrictedPanel (FR-RL-7)", () => {
  it("says the role doesn't cover the screen and links to the dashboard", () => {
    render(<RestrictedPanel />);
    expect(screen.getByText("Your role doesn't cover this screen.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
  });
});
