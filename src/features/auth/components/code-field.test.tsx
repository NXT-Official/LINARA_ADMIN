// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeField } from "./code-field";

// input-otp measures itself and looks for password managers; jsdom has neither API.
document.elementFromPoint ??= () => null;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("CodeField", () => {
  it("says whose code it is and where it comes from", () => {
    render(<CodeField value="" onChange={() => {}} id="c" />);
    const input = screen.getByLabelText("Your two-step code");
    expect(screen.getByText("The 6-digit code in your authenticator app.")).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription("The 6-digit code in your authenticator app.");
  });

  it("a dialog can say why it needs the code", () => {
    render(
      <CodeField
        value=""
        onChange={() => {}}
        id="c"
        hint="The 6-digit code in your authenticator app. It confirms it's you adding them."
      />,
    );
    expect(screen.getByLabelText("Your two-step code")).toHaveAccessibleDescription(
      "The 6-digit code in your authenticator app. It confirms it's you adding them.",
    );
  });
});
