import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ reveal: vi.fn() }));
vi.mock("./pay.actions", () => ({ revealPayFn: (...a: unknown[]) => m.reveal(...a) }));

import { payRevealer } from "./pay-reveal";

const HELPER = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";

beforeEach(() => {
  m.reveal.mockReset().mockImplementation(async ({ data }: { data: { field: string } }) =>
    data.field === "wage"
      ? { ok: true, pay: { field: "wage", monthlyRate: 18000 } }
      : {
          ok: true,
          pay: {
            field: "account",
            payoutAccount: {
              method: "PH_GCASH",
              accountName: "Carla D",
              accountNumber: "09998887777",
            },
          },
        },
  );
});

describe("payRevealer", () => {
  it("each button reveals only its own field", async () => {
    const pay = payRevealer(HELPER);
    expect(m.reveal).not.toHaveBeenCalled();
    await expect(pay.wage()).resolves.toMatch(/18,000/);
    expect(m.reveal).toHaveBeenLastCalledWith({ data: { helperId: HELPER, field: "wage" } });
    await expect(pay.account()).resolves.toBe("GCash 09998887777");
    expect(m.reveal).toHaveBeenLastCalledWith({ data: { helperId: HELPER, field: "account" } });
  });

  it("null when nothing is set", async () => {
    m.reveal.mockImplementation(async ({ data }: { data: { field: string } }) => ({
      ok: true,
      pay:
        data.field === "wage"
          ? { field: "wage", monthlyRate: null }
          : { field: "account", payoutAccount: null },
    }));
    const pay = payRevealer(HELPER);
    await expect(pay.wage()).resolves.toBeNull();
    await expect(pay.account()).resolves.toBeNull();
  });

  it("a refused reveal rejects with its message", async () => {
    m.reveal.mockResolvedValueOnce({
      ok: false,
      code: "not_allowed",
      message: "Your role doesn't allow this.",
    });
    const pay = payRevealer(HELPER);
    await expect(pay.wage()).rejects.toThrow("Your role doesn't allow this.");
    await expect(pay.wage()).resolves.toMatch(/18,000/);
  });
});
