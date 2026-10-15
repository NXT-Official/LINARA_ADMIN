// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./team.actions", () => ({
  listAdminsFn: async () => ({
    ok: true,
    admins: [{ userId: "a1", email: "ops@example.com", isYou: true }],
  }),
}));

import { SYSTEM_ACTOR, useAdmins } from "./use-admins";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("useAdmins", () => {
  it("the system actor is named Automatic job", async () => {
    const { result } = renderHook(() => useAdmins(), { wrapper });
    await waitFor(() => expect(result.current.admins).toHaveLength(1));
    expect(SYSTEM_ACTOR).toBe("00000000-0000-0000-0000-000000000000");
    expect(result.current.name(SYSTEM_ACTOR)).toBe("Automatic job");
    expect(result.current.name("a1")).toBe("You");
    expect(result.current.name("gone")).toBe("Former admin");
  });
});
