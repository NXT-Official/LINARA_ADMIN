import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveBilling } from "@/features/billing/billing.types";

// Only the server is mocked: the store and the catalog rules are real.
const server = vi.hoisted(() => ({
  loadBillingFn: vi.fn(),
  catalogActionFn: vi.fn(),
  billingActionFn: vi.fn(),
  testShiftFn: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/features/billing/billing.actions", () => server);
vi.mock("sonner", () => ({ toast: toasts }));

import { SAMPLE_NOTE } from "./components/sample-bar";
import { SAMPLE_CATALOG } from "./plans.sample";
import {
  dispatchBilling,
  dispatchCatalog,
  dispatchCatalogAndWait,
  loadLiveBilling,
  resetCatalog,
  useCatalog,
} from "./plans.store";

// The store is a module singleton; read it the way the screens do.
let current = SAMPLE_CATALOG;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
}));
// Named as a hook for the lint rule; useSyncExternalStore is mocked to a plain read above.
const useCurrent = () => (current = useCatalog());

const liveData = (over: Partial<LiveBilling["state"]> = {}): LiveBilling => ({
  state: { ...SAMPLE_CATALOG, subscriptions: [], payments: [], ...over },
  testTools: false,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  server.loadBillingFn.mockResolvedValue(liveData());
  expect(await loadLiveBilling()).toBe(true);
});
afterEach(() => {
  for (const fn of [...Object.values(server), toasts.error, toasts.success]) fn.mockReset();
});

describe("console billing, live", () => {
  it("before 018 is applied the read fails and the sample stays", async () => {
    server.loadBillingFn.mockResolvedValue({ ok: false, code: "outside_service", message: "x" });
    expect(await loadLiveBilling()).toBe(false);
  });

  it("stops calling its confirmations sample data", () => {
    expect(SAMPLE_NOTE).toBe("");
  });

  it("a change shows at once, then the database's answer replaces it", async () => {
    const saved = liveData({
      plans: SAMPLE_CATALOG.plans.map((p) => (p.id === "normal" ? { ...p, displayOrder: 99 } : p)),
    });
    server.catalogActionFn.mockResolvedValue(saved);
    const res = dispatchCatalog({ type: "move_plan", planId: "premium", direction: -1 });
    expect(res.ok).toBe(true);
    await flush();
    expect(server.catalogActionFn).toHaveBeenCalledWith({
      data: { action: { type: "move_plan", planId: "premium", direction: -1 }, code: undefined },
    });
    await flush();
    expect(useCurrent().plans.find((p) => p.id === "normal")?.displayOrder).toBe(99);
  });

  it("refused by the server: the screen goes back and says why", async () => {
    const before = useCurrent();
    server.catalogActionFn.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "Keep at least one plan published.",
    });
    // The re-read after a refusal fails too, so only the rollback can restore it.
    server.loadBillingFn.mockRejectedValue(new Error("offline"));
    dispatchCatalog({ type: "move_plan", planId: "premium", direction: -1 });
    expect(useCurrent()).not.toBe(before);
    await flush();
    expect(toasts.error).toHaveBeenCalledWith("Keep at least one plan published.");
    expect(useCurrent().plans.map((p) => [p.id, p.displayOrder])).toEqual(
      before.plans.map((p) => [p.id, p.displayOrder]),
    );
  });

  it("the network failing: back to what was there", async () => {
    const before = useCurrent();
    server.catalogActionFn.mockRejectedValue(new Error("fetch failed"));
    dispatchCatalog({ type: "move_plan", planId: "premium", direction: -1 });
    await flush();
    expect(useCurrent()).toBe(before);
    expect(toasts.error).toHaveBeenCalled();
  });

  it("a change the rules refuse never reaches the server", () => {
    const res = dispatchCatalog({ type: "create_plan", id: "free", name: "Free again" });
    expect(res.ok).toBe(false);
    expect(server.catalogActionFn).not.toHaveBeenCalled();
  });

  it("turning a switch on waits for the server, with the code, and a wrong code isn't shown as saved", async () => {
    const before = useCurrent();
    server.catalogActionFn.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "That code didn't work.",
    });
    const res = await dispatchCatalogAndWait(
      { type: "set_switch", key: "staff_pay_hr", enabled: true, note: "Cleared" },
      { code: "123456" },
    );
    expect(res).toEqual({ ok: false, message: "That code didn't work." });
    expect(server.catalogActionFn.mock.calls[0][0].data.code).toBe("123456");
    expect(useCurrent()).toBe(before);
    expect(useCurrent().switches[0].enabled).toBe(false);
  });

  it("retrying or refunding a payment is refused: that's Xendit's dashboard", () => {
    for (const type of ["retry_payment", "refund_payment"] as const) {
      const res = dispatchBilling({ type, paymentId: "p1" });
      expect(res).toMatchObject({
        ok: false,
        message: expect.stringMatching(/Xendit's dashboard/),
      });
    }
    expect(server.billingActionFn).not.toHaveBeenCalled();
  });

  it("Refresh reads the database again instead of resetting to the sample", async () => {
    server.loadBillingFn.mockResolvedValue(liveData());
    resetCatalog();
    await flush();
    // Once in beforeEach, once for Refresh.
    expect(server.loadBillingFn).toHaveBeenCalledTimes(2);
    expect(current).toBeDefined();
  });
});
