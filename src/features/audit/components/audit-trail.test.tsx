// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asRole, SUPPORT } from "@/features/auth/staff.test-utils";

const m = vi.hoisted(() => ({ audit: vi.fn(), admins: vi.fn() }));
vi.mock("../audit.actions", () => ({ listAuditFn: (...a: unknown[]) => m.audit(...a) }));
vi.mock("@/features/team/team.actions", () => ({
  listTeamNamesFn: (...a: unknown[]) => m.admins(...a),
}));

import { AuditTrail } from "./audit-trail";

const ID = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";

function renderTrail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditTrail targetId={ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.admins.mockReset().mockResolvedValue({
    ok: true,
    members: [{ userId: "a1", email: "ops@example.com" }],
  });
  m.audit.mockReset().mockResolvedValue({
    ok: true,
    hasMore: false,
    entries: [
      {
        id: "1",
        actorId: "a1",
        action: "pay.revealed",
        targetType: "helper",
        targetId: ID,
        reason: null,
        at: "2026-10-15T01:00:00Z",
      },
    ],
  });
});
afterEach(cleanup);

describe("AuditTrail (FR-US-3)", () => {
  it("lists this record's console history from the server", async () => {
    renderTrail();
    expect(await screen.findByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByText(/revealed pay details/)).toBeInTheDocument();
    expect(m.audit).toHaveBeenCalledWith({ data: { page: 0, targetId: ID } });
  });

  it("says when nothing was done here", async () => {
    m.audit.mockResolvedValue({ ok: true, hasMore: false, entries: [] });
    renderTrail();
    expect(
      await screen.findByText("No one on the team has done anything here."),
    ).toBeInTheDocument();
  });
});

describe("without audit.view (FR-RL-8)", () => {
  it("the history panel isn't shown and isn't asked for", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <AuditTrail targetId={ID} />
      </QueryClientProvider>,
      { wrapper: asRole(SUPPORT) },
    );
    expect(container).toBeEmptyDOMElement();
    expect(m.audit).not.toHaveBeenCalled();
  });
});
