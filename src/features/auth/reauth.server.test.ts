import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rate: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  writeCookies: vi.fn(),
}));
vi.mock("./rate-limit.server", () => ({ checkRateLimit: (...a: unknown[]) => m.rate(...a) }));
vi.mock("./session-cookies.server", () => ({
  writeSessionCookies: (...a: unknown[]) => m.writeCookies(...a),
}));
vi.mock("@/lib/supabase-user.server", () => ({
  getUserClient: async () => ({
    auth: { mfa: { listFactors: m.listFactors, challengeAndVerify: m.challengeAndVerify } },
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import { requireFreshCode } from "./reauth.server";
import type { StaffContext } from "./session.server";

const STAFF = { userId: "u1", accessToken: "at", refreshToken: "rt" } as StaffContext;

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
});

describe("requireFreshCode (S-5)", () => {
  it("rejects a malformed code before any call", async () => {
    await expect(requireFreshCode(STAFF, "12a456")).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(m.rate).not.toHaveBeenCalled();
  });

  it("shares the sign-in code counter", async () => {
    m.rate.mockRejectedValue(new ConsoleError("conflict", "Too many tries."));
    await expect(requireFreshCode(STAFF, "123456")).rejects.toMatchObject({ code: "conflict" });
    expect(m.rate).toHaveBeenCalledWith("code", { adminId: "u1" });
    expect(m.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a wrong code is refused", async () => {
    m.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "invalid" } });
    await expect(requireFreshCode(STAFF, "123456")).rejects.toMatchObject({
      code: "invalid_input",
      publicMessage: "That code didn't work. Check your authenticator app and try again.",
    });
    expect(m.writeCookies).not.toHaveBeenCalled();
  });

  it("a right code keeps the newest tokens", async () => {
    m.challengeAndVerify.mockResolvedValue({
      data: { access_token: "at2", refresh_token: "rt2" },
      error: null,
    });
    await expect(requireFreshCode(STAFF, "123456")).resolves.toBeUndefined();
    expect(m.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(m.writeCookies).toHaveBeenCalledWith({ accessToken: "at2", refreshToken: "rt2" });
  });
});
