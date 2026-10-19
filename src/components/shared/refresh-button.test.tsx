// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RefreshButton } from "./refresh-button";

afterEach(cleanup);

describe("RefreshButton (D41)", () => {
  it("reloads only the screen's own queries", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const users = vi.fn().mockResolvedValue("users");
    const crm = vi.fn().mockResolvedValue("crm");
    await client.prefetchQuery({ queryKey: ["users", { page: 0 }], queryFn: users });
    await client.prefetchQuery({ queryKey: ["crm", "contacts"], queryFn: crm });
    // Observed, as on a mounted screen, so an invalidation refetches them.
    new QueryObserver(client, { queryKey: ["users", { page: 0 }], queryFn: users }).subscribe(
      () => {},
    );
    new QueryObserver(client, { queryKey: ["crm", "contacts"], queryFn: crm }).subscribe(() => {});
    users.mockClear();
    crm.mockClear();

    render(
      <QueryClientProvider client={client}>
        <RefreshButton queryKeys={[["users"]]} updatedAt={Date.parse("2026-10-19T04:05:00Z")} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Loaded 12:05 PM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(users).toHaveBeenCalledTimes(1));
    expect(crm).not.toHaveBeenCalled();
    expect(client.getQueryState(["crm", "contacts"])?.isInvalidated).toBe(false);
  });
});
