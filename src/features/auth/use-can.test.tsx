// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StaffProvider } from "./staff-provider";
import { useCan } from "./use-can";

const staff = (permissions: string[]) => ({
  userId: "u1",
  email: "sup@example.com",
  roleName: "Support",
  preset: "support" as const,
  permissions,
});

describe("useCan (FR-RL-8)", () => {
  it("useCan reads the provider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StaffProvider staff={staff(["dashboard.view", "support.view"])}>{children}</StaffProvider>
    );
    const { result } = renderHook(() => useCan(), { wrapper });
    expect(result.current("support.view")).toBe(true);
    expect(result.current("crm.write")).toBe(false);
  });

  it("useCan without a provider allows", () => {
    const { result } = renderHook(() => useCan());
    expect(result.current("team.manage")).toBe(true);
  });
});
