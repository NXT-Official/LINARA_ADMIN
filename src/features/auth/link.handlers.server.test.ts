import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  captcha: vi.fn(),
  rate: vi.fn(),
  memIp: vi.fn(),
  reset: vi.fn(),
  updateUser: vi.fn(),
  userSignOut: vi.fn(),
  getClaims: vi.fn(),
  roleRow: null as { role: string } | null,
  writeCookies: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("./captcha.server", () => ({ verifyCaptcha: (...a: unknown[]) => m.captcha(...a) }));
vi.mock("./rate-limit.server", () => ({
  checkRateLimit: (...a: unknown[]) => m.rate(...a),
  memoryGuardIp: () => m.memIp(),
}));
vi.mock("./session-cookies.server", () => ({
  writeSessionCookies: (...a: unknown[]) => m.writeCookies(...a),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestIP: () => "1.2.3.4" }));
vi.mock("@/lib/server-env.server", () => ({
  serverEnv: () => ({ siteUrl: "http://localhost:8081" }),
}));
vi.mock("@/lib/supabase-user.server", () => ({
  getAnonClient: () => ({ auth: { resetPasswordForEmail: m.reset } }),
  getUserClient: async () => ({ auth: { updateUser: m.updateUser, signOut: m.userSignOut } }),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    auth: { getClaims: m.getClaims },
    rpc: (...a: unknown[]) => m.lookup(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: m.roleRow, error: null }) }),
      }),
    }),
  }),
}));

import { ConsoleError } from "@/lib/console-error";

import { WRONG_PASSWORD } from "./auth.handlers.server";
import { requestPasswordResetHandler, setPasswordFromLinkHandler } from "./link.handlers.server";

const linkInput = {
  accessToken: "at",
  refreshToken: "rt",
  password: "a long enough password",
  purpose: "invite" as const,
};

beforeEach(() => {
  for (const f of Object.values(m)) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  m.roleRow = { role: "admin" };
  m.getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  m.updateUser.mockResolvedValue({ error: null });
  m.lookup.mockResolvedValue({
    data: [{ user_id: "u1", has_household_profile: false }],
    error: null,
  });
});

describe("requestPasswordResetHandler (S-4)", () => {
  it("reset answers the same for unknown emails", async () => {
    m.reset.mockResolvedValue({ error: null });
    await expect(
      requestPasswordResetHandler({ email: "a@x.com", captchaToken: "t" }),
    ).resolves.toEqual({ ok: true });
    m.reset.mockResolvedValue({ error: { message: "User not found" } });
    await expect(
      requestPasswordResetHandler({ email: "nobody@x.com", captchaToken: "t" }),
    ).resolves.toEqual({ ok: true });
  });

  it("reset links only return to this console", async () => {
    m.reset.mockResolvedValue({ error: null });
    await requestPasswordResetHandler({ email: "a@x.com", captchaToken: "t" });
    expect(m.reset).toHaveBeenCalledWith("a@x.com", {
      redirectTo: "http://localhost:8081/reset-password",
    });
  });

  it("only console admins get a reset email, with the same answer for everyone", async () => {
    m.lookup.mockResolvedValue({
      data: [{ user_id: "h1", has_household_profile: true }],
      error: null,
    });
    m.roleRow = null;
    await expect(
      requestPasswordResetHandler({ email: "parent@x.com", captchaToken: "t" }),
    ).resolves.toEqual({ ok: true });
    expect(m.reset).not.toHaveBeenCalled();
  });

  it("reset over the limit looks the same", async () => {
    m.rate.mockRejectedValue(new ConsoleError("conflict", "Too many tries."));
    await expect(
      requestPasswordResetHandler({ email: "a@x.com", captchaToken: "t" }),
    ).resolves.toEqual({ ok: true });
    expect(m.reset).not.toHaveBeenCalled();
  });

  it("a failed captcha is the one thing it reports", async () => {
    m.captcha.mockRejectedValue(new ConsoleError("invalid_input", "Complete the captcha check."));
    await expect(
      requestPasswordResetHandler({ email: "a@x.com", captchaToken: null }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" });
    expect(m.rate).not.toHaveBeenCalled();
  });
});

describe("setPasswordFromLinkHandler", () => {
  it("short passwords are refused", async () => {
    await expect(
      setPasswordFromLinkHandler({ ...linkInput, password: "elevenchars" }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      message: "Use at least 12 characters.",
    });
    expect(m.updateUser).not.toHaveBeenCalled();
    expect(m.rate).not.toHaveBeenCalled();
  });

  it("invite needs a console role", async () => {
    m.roleRow = null;
    await expect(setPasswordFromLinkHandler(linkInput)).resolves.toEqual(WRONG_PASSWORD);
    expect(m.updateUser).not.toHaveBeenCalled();
    expect(m.writeCookies).not.toHaveBeenCalled();
  });

  it("an accepted invite goes to two-step setup, signed in", async () => {
    await expect(setPasswordFromLinkHandler(linkInput)).resolves.toEqual({
      ok: true,
      next: "/sign-in/set-up",
    });
    expect(m.updateUser).toHaveBeenCalledWith({ password: "a long enough password" });
    expect(m.writeCookies).toHaveBeenCalledWith({ accessToken: "at", refreshToken: "rt" });
  });

  it("a reset signs the link session out and sends the admin to sign in", async () => {
    await expect(
      setPasswordFromLinkHandler({ ...linkInput, purpose: "recovery" }),
    ).resolves.toEqual({ ok: true, next: "/sign-in" });
    expect(m.userSignOut).toHaveBeenCalled();
    expect(m.writeCookies).not.toHaveBeenCalled();
  });

  it("an expired link says so", async () => {
    m.getClaims.mockResolvedValue({ data: null, error: { message: "expired" } });
    await expect(setPasswordFromLinkHandler(linkInput)).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      message: "This link has expired or was already used. Ask for a new one.",
    });
  });
});
