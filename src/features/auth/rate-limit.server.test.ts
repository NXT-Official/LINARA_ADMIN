import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-admin.server", () => ({ getAdminClient: () => ({ rpc }) }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestIP: () => "1.2.3.4" }));

import { resetMemoryLimit } from "./memory-limit.server";
import { RATE_RULES, checkRateLimit, memoryGuardIp, rateKey } from "./rate-limit.server";

describe("rate limits (D30)", () => {
  beforeEach(() => {
    rpc.mockReset();
    resetMemoryLimit();
  });

  it("keys never hold the raw value", () => {
    const k = rateKey("email", "sign_in", " Ana@X.com ");
    expect(k).toBe(rateKey("email", "sign_in", "ana@x.com"));
    expect(k.startsWith("sign_in:email:")).toBe(true);
    expect(k).not.toContain("ana");
    expect(rateKey("ip", "sign_in", "1.2.3.4")).not.toContain("1.2.3.4");
  });

  it("rules match the plan", () => {
    expect(RATE_RULES.sign_in).toEqual({
      windowMinutes: 15,
      limits: [
        { kind: "email", max: 5 },
        { kind: "ip", max: 20 },
      ],
    });
    expect(RATE_RULES.reset).toEqual({
      windowMinutes: 60,
      limits: [
        { kind: "email", max: 3 },
        { kind: "ip", max: 20 },
      ],
    });
    expect(RATE_RULES.code).toEqual({ windowMinutes: 15, limits: [{ kind: "admin", max: 5 }] });
    expect(RATE_RULES.link).toEqual({ windowMinutes: 15, limits: [{ kind: "ip", max: 10 }] });
    expect(RATE_RULES.add_admin).toEqual({
      windowMinutes: 60,
      limits: [{ kind: "admin", max: 10 }],
    });
    expect(RATE_RULES.export).toEqual({ windowMinutes: 60, limits: [{ kind: "admin", max: 30 }] });
    expect(RATE_RULES.team_change).toEqual({
      windowMinutes: 60,
      limits: [{ kind: "admin", max: 30 }],
    });
  });

  it("one database call per check", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await checkRateLimit("sign_in", { email: "a@x.com", ip: "1.2.3.4" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("staff_record_attempt");
    expect(args.p_keys).toHaveLength(2);
    expect(args.p_window).toBe("15 minutes");
  });

  it("over the limit rejects, at the limit passes", async () => {
    const emailKey = rateKey("email", "sign_in", "a@x.com");
    rpc.mockResolvedValue({ data: [{ key: emailKey, attempts: 6 }], error: null });
    await expect(
      checkRateLimit("sign_in", { email: "a@x.com", ip: "1.2.3.4" }),
    ).rejects.toMatchObject({
      code: "conflict",
      publicMessage: "Too many tries. Wait 15 minutes, then try again.",
    });
    rpc.mockResolvedValue({ data: [{ key: emailKey, attempts: 5 }], error: null });
    await expect(
      checkRateLimit("sign_in", { email: "a@x.com", ip: "1.2.3.4" }),
    ).resolves.toBeUndefined();
  });

  it("skips keys it has no subject for", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await checkRateLimit("sign_in", { email: "a@x.com" });
    expect(rpc.mock.calls[0][1].p_keys).toHaveLength(1);
  });

  it("fails closed when the counter can't be read", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(checkRateLimit("code", { adminId: "u1" })).rejects.toMatchObject({
      code: "outside_service",
    });
  });

  it("memory guard blocks the 31st request a minute from one address", () => {
    for (let i = 0; i < 30; i++) expect(() => memoryGuardIp()).not.toThrow();
    expect(() => memoryGuardIp()).toThrow(/Too many requests/);
  });
});
