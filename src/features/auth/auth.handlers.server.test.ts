import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks -------------------------------------------------------------------
const m = vi.hoisted(() => ({
  captcha: vi.fn(),
  rate: vi.fn(),
  memIp: vi.fn(),
  audit: vi.fn(),
  writeCookies: vi.fn(),
  clearCookies: vi.fn(),
  requireStaff: vi.fn(),
  signIn: vi.fn(),
  roleRow: null as { role: string } | null,
  adminSignOut: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
  del: vi.fn(),
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  userSignOut: vi.fn(),
  calls: [] as string[],
}));

vi.mock("./captcha.server", () => ({
  verifyCaptcha: async (...a: unknown[]) => {
    m.calls.push("captcha");
    return m.captcha(...a);
  },
}));
vi.mock("./rate-limit.server", () => ({
  checkRateLimit: async (...a: unknown[]) => {
    m.calls.push(`rate:${a[0]}`);
    return m.rate(...a);
  },
  memoryGuardIp: () => m.memIp(),
}));
vi.mock("@/features/audit/audit.server", () => ({
  writeAudit: (...a: unknown[]) => m.audit(...a),
}));
vi.mock("./session-cookies.server", () => ({
  writeSessionCookies: (...a: unknown[]) => m.writeCookies(...a),
  clearSessionCookies: () => m.clearCookies(),
  readSessionCookies: () => null,
}));
vi.mock("./session.server", () => ({ requireStaff: (...a: unknown[]) => m.requireStaff(...a) }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestIP: () => "1.2.3.4" }));
vi.mock("@/lib/supabase-user.server", () => ({
  getAnonClient: () => ({
    auth: {
      signInWithPassword: async (...a: unknown[]) => {
        m.calls.push("signIn");
        return m.signIn(...a);
      },
    },
  }),
  getUserClient: async () => ({
    auth: {
      signOut: m.userSignOut,
      mfa: {
        listFactors: m.listFactors,
        unenroll: m.unenroll,
        enroll: m.enroll,
        challengeAndVerify: m.challengeAndVerify,
      },
    },
  }),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    auth: { getClaims: m.getClaims, admin: { signOut: m.adminSignOut } },
    rpc: m.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: m.roleRow, error: null }) }),
      }),
      delete: () => ({ eq: (...a: unknown[]) => m.del(...a) }),
    }),
  }),
}));

import {
  WRONG_PASSWORD,
  signInHandler,
  signOutHandler,
  startTwoStepSetupHandler,
  verifyTwoStepHandler,
} from "./auth.handlers.server";

const STAFF = {
  userId: "u1",
  email: "admin@example.com",
  role: "admin",
  sessionId: "s1",
  aal: "aal1",
  accessToken: "at",
  refreshToken: "rt",
};
const goodInput = { email: "admin@example.com", password: "correct horse", captchaToken: "tok" };
const session = { access_token: "at1", refresh_token: "rt1" };

beforeEach(() => {
  for (const f of Object.values(m)) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  m.calls = [];
  m.roleRow = { role: "admin" };
  m.requireStaff.mockResolvedValue(STAFF);
  m.getClaims.mockResolvedValue({ data: { claims: { session_id: "s2", sub: "u1" } }, error: null });
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.audit.mockResolvedValue(undefined);
});

describe("signInHandler", () => {
  it("wrong password gets the generic answer", async () => {
    m.signIn.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    await expect(signInHandler(goodInput)).resolves.toEqual(WRONG_PASSWORD);
    expect(m.writeCookies).not.toHaveBeenCalled();
  });

  it("non-admin gets the wrong-password answer", async () => {
    m.signIn.mockResolvedValue({
      data: { session, user: { id: "u9", factors: [] } },
      error: null,
    });
    m.roleRow = null;
    await expect(signInHandler(goodInput)).resolves.toEqual(WRONG_PASSWORD);
    expect(m.adminSignOut).toHaveBeenCalledWith("at1");
    expect(m.writeCookies).not.toHaveBeenCalled();
  });

  it("admin without two-step goes to set-up", async () => {
    m.signIn.mockResolvedValue({ data: { session, user: { id: "u1", factors: [] } }, error: null });
    await expect(signInHandler(goodInput)).resolves.toEqual({ ok: true, next: "set-up" });
    expect(m.writeCookies).toHaveBeenCalledWith({ accessToken: "at1", refreshToken: "rt1" });
  });

  it("admin with two-step goes to the code", async () => {
    m.signIn.mockResolvedValue({
      data: {
        session,
        user: { id: "u1", factors: [{ id: "f1", factor_type: "totp", status: "verified" }] },
      },
      error: null,
    });
    await expect(signInHandler(goodInput)).resolves.toEqual({ ok: true, next: "two-step" });
  });

  it("cheap checks run first", async () => {
    await expect(signInHandler({ ...goodInput, email: "not-an-email" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(m.calls).toEqual([]);

    m.captcha.mockRejectedValue(Object.assign(new Error("x"), { code: "invalid_input" }));
    await signInHandler(goodInput);
    expect(m.calls).toEqual(["captcha"]);
  });

  it("checks run in order: captcha, database limit, then Supabase Auth", async () => {
    m.signIn.mockResolvedValue({ data: {}, error: { message: "bad" } });
    await signInHandler(goodInput);
    expect(m.calls).toEqual(["captcha", "rate:sign_in", "signIn"]);
  });
});

describe("startTwoStepSetupHandler", () => {
  it("enroll removes unverified factors first", async () => {
    m.unenroll.mockResolvedValue({ error: null });
    m.listFactors.mockResolvedValue({
      data: { all: [{ id: "old", factor_type: "totp", status: "unverified" }], totp: [] },
      error: null,
    });
    m.enroll.mockResolvedValue({
      data: { id: "f2", totp: { qr_code: "data:image/svg+xml;x", secret: "ABCDEFGH" } },
      error: null,
    });
    await expect(startTwoStepSetupHandler()).resolves.toEqual({
      ok: true,
      factorId: "f2",
      qrCode: "data:image/svg+xml;x",
      secret: "ABCDEFGH",
    });
    expect(m.unenroll).toHaveBeenCalledWith({ factorId: "old" });
    expect(m.unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      m.enroll.mock.invocationCallOrder[0],
    );
  });

  it("a second setup running at the same time doesn't fail on the name", async () => {
    // Another request created the factor between our list and our enroll.
    m.listFactors
      .mockResolvedValueOnce({ data: { all: [], totp: [] }, error: null })
      .mockResolvedValueOnce({
        data: { all: [{ id: "raced", factor_type: "totp", status: "unverified" }], totp: [] },
        error: null,
      });
    m.unenroll.mockResolvedValue({ error: null });
    m.enroll
      .mockResolvedValueOnce({
        data: null,
        error: {
          message:
            'A factor with the friendly name "Linara Business Console" for this user already exists',
        },
      })
      .mockResolvedValueOnce({
        data: { id: "f3", totp: { qr_code: "data:image/svg+xml;y", secret: "SECRET2" } },
        error: null,
      });
    await expect(startTwoStepSetupHandler()).resolves.toMatchObject({ ok: true, factorId: "f3" });
    expect(m.unenroll).toHaveBeenCalledWith({ factorId: "raced" });
    expect(m.enroll).toHaveBeenCalledTimes(2);
  });

  it("a failed removal of an old factor isn't ignored", async () => {
    m.listFactors.mockResolvedValue({
      data: { all: [{ id: "old", factor_type: "totp", status: "unverified" }], totp: [] },
      error: null,
    });
    m.unenroll.mockResolvedValue({ error: { message: "nope" } });
    await expect(startTwoStepSetupHandler()).resolves.toMatchObject({
      ok: false,
      code: "outside_service",
    });
    expect(m.enroll).not.toHaveBeenCalled();
  });

  it("a password alone can't add a second authenticator", async () => {
    m.listFactors.mockResolvedValue({
      data: { all: [{ id: "f1", factor_type: "totp", status: "verified" }], totp: [{ id: "f1" }] },
      error: null,
    });
    await expect(startTwoStepSetupHandler()).resolves.toMatchObject({
      ok: false,
      code: "not_allowed",
    });
    expect(m.enroll).not.toHaveBeenCalled();
  });
});

describe("verifyTwoStepHandler", () => {
  beforeEach(() => {
    m.listFactors.mockResolvedValue({ data: { all: [], totp: [{ id: "f1" }] }, error: null });
  });

  it("a wrong code doesn't sign in", async () => {
    m.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "Invalid TOTP code" } });
    await expect(verifyTwoStepHandler({ code: "123456" })).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      message: "That code didn't work. Check your authenticator app and try again.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.writeCookies).not.toHaveBeenCalled();
  });

  it("a right code starts the session", async () => {
    m.challengeAndVerify.mockResolvedValue({ data: session, error: null });
    await expect(verifyTwoStepHandler({ code: "123456" })).resolves.toEqual({ ok: true });
    expect(m.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(m.writeCookies).toHaveBeenCalledWith({ accessToken: "at1", refreshToken: "rt1" });
    expect(m.rpc).toHaveBeenCalledWith("staff_start_session", {
      p_session_id: "s2",
      p_user_id: "u1",
    });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "u1", action: "auth.signed_in" }),
    );
  });

  it("code guessing is limited", async () => {
    m.rate.mockRejectedValue(
      Object.assign(new Error("x"), {
        code: "conflict",
        publicMessage: "Too many tries. Wait 15 minutes, then try again.",
      }),
    );
    // Rate-limit errors are ConsoleErrors in real code; reuse the real class.
    const { ConsoleError } = await import("@/lib/console-error");
    m.rate.mockRejectedValue(
      new ConsoleError("conflict", "Too many tries. Wait 15 minutes, then try again."),
    );
    await expect(verifyTwoStepHandler({ code: "123456" })).resolves.toEqual({
      ok: false,
      code: "conflict",
      message: "Too many tries. Wait 15 minutes, then try again.",
    });
    expect(m.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("rejects malformed codes before any call", async () => {
    await expect(verifyTwoStepHandler({ code: "12ab" })).resolves.toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(m.calls).toEqual([]);
    expect(m.challengeAndVerify).not.toHaveBeenCalled();
  });
});

describe("signOutHandler", () => {
  it("ends the console session and clears cookies", async () => {
    m.requireStaff.mockResolvedValue({ ...STAFF, aal: "aal2" });
    await expect(signOutHandler()).resolves.toEqual({ ok: true });
    expect(m.del).toHaveBeenCalledWith("session_id", "s1");
    expect(m.clearCookies).toHaveBeenCalled();
  });

  it("still clears cookies when the session is already gone", async () => {
    const { ConsoleError } = await import("@/lib/console-error");
    m.requireStaff.mockRejectedValue(new ConsoleError("not_signed_in"));
    await expect(signOutHandler()).resolves.toEqual({ ok: true });
    expect(m.clearCookies).toHaveBeenCalled();
  });
});
