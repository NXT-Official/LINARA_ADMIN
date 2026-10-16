import { getRequestIP } from "@tanstack/react-start/server";

import { ConsoleError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { getAnonClient } from "@/lib/supabase-user.server";

import { memoryLimit } from "./memory-limit.server";
import { can, type Permission, type RolePreset } from "./permissions";
import {
  clearSessionCookies,
  readSessionCookies,
  writeSessionCookies,
} from "./session-cookies.server";

export const IDLE_LIMIT_MS = 30 * 60_000; // S-5
export const SESSION_CAP_MS = 12 * 60 * 60_000; // D29
const REFRESH_MARGIN_S = 60;
const CALLS_PER_MINUTE = 120; // D30, memory tier, per admin
const IP_CALLS_PER_MINUTE = 300; // D30, memory tier, per address (an office shares one)
const TOO_MANY = "Too many requests. Wait a minute, then try again.";

/** The member's one role and what it allows (D39). */
export type RoleFacts = {
  roleId: string;
  roleName: string;
  preset: RolePreset | null;
  permissions: Permission[];
};

export type StaffContext = RoleFacts & {
  userId: string;
  email: string;
  sessionId: string;
  aal: "aal1" | "aal2";
  accessToken: string;
  refreshToken: string;
};

export type SessionFacts = {
  now: Date;
  role: RoleFacts | null;
  aal: string;
  signedInAt: Date;
  lastSeenAt: Date | null;
};

type Reason = "no_role" | "needs_two_step" | "idle" | "expired";

/** The session rules, with no I/O (S-5, D29). */
export function evaluateSession(
  f: SessionFacts,
  needs: { aal2: boolean },
): { ok: true } | { ok: false; reason: Reason } {
  if (!f.role) return { ok: false, reason: "no_role" };
  if (f.now.getTime() - f.signedInAt.getTime() > SESSION_CAP_MS)
    return { ok: false, reason: "expired" };
  if (f.lastSeenAt && f.now.getTime() - f.lastSeenAt.getTime() > IDLE_LIMIT_MS) {
    return { ok: false, reason: "idle" };
  }
  if (needs.aal2 && f.aal !== "aal2") return { ok: false, reason: "needs_two_step" };
  return { ok: true };
}

const MESSAGE: Record<Reason | "signed_out", string> = {
  idle: "You were signed out after 30 minutes without activity.",
  expired: "Your session ended after 12 hours. Sign in again.",
  no_role: "Sign in to continue.",
  needs_two_step: "Sign in to continue.",
  signed_out: "Sign in to continue.",
};

type DbRoleDef = { id: string; name: string; preset: RolePreset | null; permissions: string[] };
type DbTouchRow = {
  role_id: string;
  role_name: string;
  preset: RolePreset | null;
  permissions: string[];
  started_at: string;
  last_seen_at: string;
};

type Claims = {
  sub: string;
  email?: string;
  aal?: string;
  session_id?: string;
  iat?: number;
  exp?: number;
};

/** Reads a token's payload WITHOUT verifying it: only for refresh timing. */
function peek(token: string): Partial<Claims> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function signedOut(reason: Reason | "signed_out"): ConsoleError {
  clearSessionCookies();
  return new ConsoleError("not_signed_in", MESSAGE[reason]);
}

/**
 * The guard every server function runs first (spec §7.3, step 3). Costs at
 * most one database call and no Auth call on a normal request (D31).
 */
export async function requireStaff(
  permission: Permission | null,
  opts: { allowAal1?: boolean } = {},
): Promise<StaffContext> {
  // Per address first: a token's user id can't be trusted until it's verified,
  // and a refresh below costs an Auth call.
  if (!memoryLimit(`fn-ip:${getRequestIP() ?? "?"}`, IP_CALLS_PER_MINUTE, 60_000)) {
    throw new ConsoleError("conflict", TOO_MANY);
  }
  const cookies = readSessionCookies();
  if (!cookies) throw new ConsoleError("not_signed_in", MESSAGE.signed_out);

  let { accessToken, refreshToken } = cookies;

  // The only Auth network call: about once an hour per admin.
  const exp = peek(accessToken).exp ?? 0;
  if (exp - Date.now() / 1000 < REFRESH_MARGIN_S) {
    const { data, error } = await getAnonClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) throw signedOut("signed_out");
    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    writeSessionCookies({ accessToken, refreshToken });
  }

  // Verified locally against the project's cached ES256 public key.
  const admin = getAdminClient();
  const { data: claimData, error: claimError } = await admin.auth.getClaims(accessToken);
  const claims = claimData?.claims as Claims | undefined;
  if (claimError || !claims?.sub || !claims.session_id) throw signedOut("signed_out");
  if (!memoryLimit(`fn:${claims.sub}`, CALLS_PER_MINUTE, 60_000)) {
    throw new ConsoleError("conflict", TOO_MANY);
  }

  const now = new Date();
  let role: RoleFacts | null = null;
  let signedInAt = new Date((claims.iat ?? 0) * 1000);
  let lastSeenAt: Date | null = null;

  if (opts.allowAal1) {
    // Two-step setup or code entry: no console session row exists yet.
    const { data, error } = await admin
      .from("staff_roles")
      .select("role_id, staff_role_defs(id, name, preset, permissions)")
      .eq("user_id", claims.sub)
      .maybeSingle<{ role_id: string; staff_role_defs: DbRoleDef | null }>();
    if (error) {
      logError("role lookup", error.message);
      throw new ConsoleError("outside_service");
    }
    const def = data?.staff_role_defs;
    role = def
      ? {
          roleId: def.id,
          roleName: def.name,
          preset: def.preset,
          permissions: def.permissions as Permission[],
        }
      : null;
  } else {
    const { data, error } = await admin.rpc("staff_touch_session", {
      p_session_id: claims.session_id,
      p_user_id: claims.sub,
    });
    if (error) {
      logError("touch session", error.message);
      throw new ConsoleError("outside_service");
    }
    const row = (data as DbTouchRow[] | null)?.[0];
    if (row) {
      role = {
        roleId: row.role_id,
        roleName: row.role_name,
        preset: row.preset,
        permissions: row.permissions as Permission[],
      };
      signedInAt = new Date(row.started_at);
      lastSeenAt = new Date(row.last_seen_at);
    }
  }

  const verdict = evaluateSession(
    { now, role, aal: claims.aal ?? "aal1", signedInAt, lastSeenAt },
    { aal2: !opts.allowAal1 },
  );
  if (!verdict.ok) {
    if (verdict.reason === "idle" || verdict.reason === "expired") {
      await admin.rpc("staff_end_sessions", { p_user_id: claims.sub });
    }
    throw signedOut(verdict.reason);
  }

  const facts = role as RoleFacts;
  if (permission && !can(facts.permissions, permission)) throw new ConsoleError("not_allowed");

  return {
    userId: claims.sub,
    email: claims.email ?? "",
    ...facts,
    sessionId: claims.session_id,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    accessToken,
    refreshToken,
  };
}
