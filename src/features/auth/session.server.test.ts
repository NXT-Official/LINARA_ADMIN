import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks: cookies, clients, request IP ------------------------------------
const cookies = vi.hoisted(() => ({
  current: null as { accessToken: string; refreshToken: string } | null,
  written: [] as unknown[],
  cleared: 0,
}));
vi.mock("./session-cookies.server", () => ({
  readSessionCookies: () => cookies.current,
  writeSessionCookies: (t: unknown) => cookies.written.push(t),
  clearSessionCookies: () => {
    cookies.cleared += 1;
  },
}));

const admin = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
  touchRows: [] as unknown[],
  roleRow: null as { role: string } | null,
  rpc: vi.fn(),
  getClaims: vi.fn(),
  getUser: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/lib/supabase-admin.server", () => ({
  getAdminClient: () => ({
    auth: { getClaims: admin.getClaims, getUser: admin.getUser },
    rpc: admin.rpc,
    from: () => ({
      select: (...a: unknown[]) => {
        admin.select(...a);
        return { eq: () => ({ maybeSingle: async () => ({ data: admin.roleRow, error: null }) }) };
      },
    }),
  }),
}));

const anon = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock("@/lib/supabase-user.server", () => ({
  getAnonClient: () => ({ auth: { refreshSession: anon.refreshSession } }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestIP: () => "1.2.3.4" }));

const perm = vi.hoisted(() => ({ deny: false }));
vi.mock("./permissions", async (orig) => {
  const real = await orig<typeof import("./permissions")>();
  return { ...real, can: (...a: Parameters<typeof real.can>) => !perm.deny && real.can(...a) };
});

import { resetMemoryLimit } from "./memory-limit.server";
import { evaluateSession, requireStaff } from "./session.server";

// --- helpers ----------------------------------------------------------------
const NOW = new Date("2026-10-14T04:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

/** An unsigned token whose payload the guard can read (verification is mocked). */
function token(payload: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "ES256" })}.${b64(payload)}.sig`;
}
const claimsFor = (expInSeconds: number, aal = "aal2") => ({
  sub: "user-1",
  email: "admin@example.com",
  aal,
  session_id: "sess-1",
  iat: Math.floor(NOW.getTime() / 1000) - 600,
  exp: Math.floor(NOW.getTime() / 1000) + expInSeconds,
});

describe("evaluateSession", () => {
  const base = {
    now: NOW,
    role: "admin" as const,
    aal: "aal2",
    signedInAt: ago(HOUR),
    lastSeenAt: ago(5 * MIN),
  };

  it("accepts an active admin at aal2", () => {
    expect(evaluateSession(base, { aal2: true })).toEqual({ ok: true });
  });

  it("rejects when the role is gone", () => {
    expect(evaluateSession({ ...base, role: null }, { aal2: true })).toEqual({
      ok: false,
      reason: "no_role",
    });
  });

  it("rejects after 30 idle minutes", () => {
    expect(evaluateSession({ ...base, lastSeenAt: ago(31 * MIN) }, { aal2: true })).toEqual({
      ok: false,
      reason: "idle",
    });
    expect(evaluateSession({ ...base, lastSeenAt: ago(29 * MIN) }, { aal2: true })).toEqual({
      ok: true,
    });
  });

  it("rejects after 12 hours", () => {
    expect(
      evaluateSession(
        { ...base, signedInAt: ago(12 * HOUR + MIN), lastSeenAt: ago(MIN) },
        { aal2: true },
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("requires two-step unless allowed", () => {
    expect(evaluateSession({ ...base, aal: "aal1" }, { aal2: true })).toEqual({
      ok: false,
      reason: "needs_two_step",
    });
    expect(evaluateSession({ ...base, aal: "aal1" }, { aal2: false })).toEqual({ ok: true });
  });
});

describe("requireStaff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetMemoryLimit();
    cookies.written = [];
    cookies.cleared = 0;
    for (const f of [
      admin.rpc,
      admin.getClaims,
      admin.getUser,
      admin.select,
      anon.refreshSession,
    ]) {
      f.mockReset();
    }
    const c = claimsFor(600);
    cookies.current = { accessToken: token(c), refreshToken: "r1" };
    admin.getClaims.mockResolvedValue({ data: { claims: c }, error: null });
    admin.rpc.mockResolvedValue({
      data: [
        {
          role: "admin",
          started_at: ago(HOUR).toISOString(),
          last_seen_at: ago(MIN).toISOString(),
        },
      ],
      error: null,
    });
    admin.roleRow = { role: "admin" };
  });

  it("returns the admin for a valid session", async () => {
    await expect(requireStaff("team.manage")).resolves.toMatchObject({
      userId: "user-1",
      email: "admin@example.com",
      role: "admin",
      sessionId: "sess-1",
      aal: "aal2",
    });
  });

  it("one database call and no Auth call per request (D31)", async () => {
    await requireStaff("dashboard.view");
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("staff_touch_session", {
      p_session_id: "sess-1",
      p_user_id: "user-1",
    });
    expect(admin.getClaims).toHaveBeenCalledTimes(1);
    expect(admin.getUser).not.toHaveBeenCalled();
    expect(anon.refreshSession).not.toHaveBeenCalled();
    expect(admin.select).not.toHaveBeenCalled();
  });

  it("refreshes only near expiry", async () => {
    const soon = claimsFor(30);
    const fresh = claimsFor(3600);
    cookies.current = { accessToken: token(soon), refreshToken: "r1" };
    anon.refreshSession.mockResolvedValue({
      data: { session: { access_token: token(fresh), refresh_token: "r2" } },
      error: null,
    });
    admin.getClaims.mockResolvedValue({ data: { claims: fresh }, error: null });
    await requireStaff(null);
    expect(anon.refreshSession).toHaveBeenCalledTimes(1);
    expect(cookies.written).toEqual([{ accessToken: token(fresh), refreshToken: "r2" }]);

    anon.refreshSession.mockClear();
    cookies.written = [];
    cookies.current = { accessToken: token(claimsFor(300)), refreshToken: "r1" };
    admin.getClaims.mockResolvedValue({ data: { claims: claimsFor(300) }, error: null });
    await requireStaff(null);
    expect(anon.refreshSession).not.toHaveBeenCalled();
  });

  it("two-step setup mode skips the session row", async () => {
    const c = claimsFor(600, "aal1");
    cookies.current = { accessToken: token(c), refreshToken: "r1" };
    admin.getClaims.mockResolvedValue({ data: { claims: c }, error: null });
    await expect(requireStaff(null, { allowAal1: true })).resolves.toMatchObject({ aal: "aal1" });
    expect(admin.select).toHaveBeenCalledTimes(1);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("refuses aal1 outside two-step setup", async () => {
    const c = claimsFor(600, "aal1");
    cookies.current = { accessToken: token(c), refreshToken: "r1" };
    admin.getClaims.mockResolvedValue({ data: { claims: c }, error: null });
    await expect(requireStaff(null)).rejects.toMatchObject({ code: "not_signed_in" });
  });

  it("signs out a removed admin on the very next request", async () => {
    admin.rpc.mockResolvedValue({ data: [], error: null });
    await expect(requireStaff(null)).rejects.toMatchObject({
      code: "not_signed_in",
      publicMessage: "Sign in to continue.",
    });
    expect(cookies.cleared).toBe(1);
  });

  it("explains an idle sign-out", async () => {
    admin.rpc.mockImplementation(async (fn: string) =>
      fn === "staff_touch_session"
        ? {
            data: [
              {
                role: "admin",
                started_at: ago(HOUR).toISOString(),
                last_seen_at: ago(31 * MIN).toISOString(),
              },
            ],
            error: null,
          }
        : { data: 1, error: null },
    );
    await expect(requireStaff(null)).rejects.toMatchObject({
      code: "not_signed_in",
      publicMessage: "You were signed out after 30 minutes without activity.",
    });
    expect(admin.rpc).toHaveBeenCalledWith("staff_end_sessions", { p_user_id: "user-1" });
  });

  it("requireStaff refuses a permission the role lacks", async () => {
    perm.deny = true;
    try {
      await expect(requireStaff("team.manage")).rejects.toMatchObject({ code: "not_allowed" });
    } finally {
      perm.deny = false;
    }
  });

  it("rejects without cookies, before any Supabase call", async () => {
    cookies.current = null;
    await expect(requireStaff(null)).rejects.toMatchObject({ code: "not_signed_in" });
    expect(admin.getClaims).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("stops a burst before it reaches Supabase", async () => {
    for (let i = 0; i < 120; i++) await requireStaff(null);
    const callsBefore = admin.rpc.mock.calls.length;
    await expect(requireStaff(null)).rejects.toMatchObject({ code: "conflict" });
    expect(admin.rpc.mock.calls.length).toBe(callsBefore);
  });

  it("forged tokens can't dodge the limit by changing their user id", async () => {
    // Unverified, expired tokens with a new `sub` each time: each one would
    // otherwise cost a Supabase Auth refresh call.
    anon.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("bad") });
    const forged = (i: number) => ({
      accessToken: token({ sub: `forged-${i}`, exp: 0 }),
      refreshToken: `r-${i}`,
    });
    for (let i = 0; i < 300; i++) {
      cookies.current = forged(i);
      await requireStaff(null).catch(() => undefined);
    }
    const refreshesBefore = anon.refreshSession.mock.calls.length;
    cookies.current = forged(300);
    await expect(requireStaff(null)).rejects.toMatchObject({ code: "conflict" });
    expect(anon.refreshSession.mock.calls.length).toBe(refreshesBefore);
  });
});
