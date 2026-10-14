import { getRequestIP } from "@tanstack/react-start/server";

import { writeAudit } from "@/features/audit/audit.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { getAnonClient, getUserClient } from "@/lib/supabase-user.server";

import { verifyCaptcha } from "./captcha.server";
import { checkRateLimit, memoryGuardIp } from "./rate-limit.server";
import { clearSessionCookies, writeSessionCookies } from "./session-cookies.server";
import { requireStaff } from "./session.server";

/**
 * Sign-in, two-step and sign-out (spec S-1, S-2, D26 to D31). Checks run
 * cheapest first: memory limit, input, hCaptcha, database limit, Supabase Auth.
 * Every handler returns a result instead of throwing, so the browser only
 * ever sees a code and a plain message (§10).
 */

/** The same answer for a wrong password and for an account with no console role (S-2). */
export const WRONG_PASSWORD: PublicError = {
  ok: false,
  code: "invalid_input",
  message: "Email or password is incorrect.",
};
const WRONG_CODE = "That code didn't work. Check your authenticator app and try again.";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

type Factor = { id: string; factor_type: string; status: string };

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("auth", e);
    return toPublicError(e);
  }
}

// ---------------------------------------------------------------- Sign in

export type SignInInput = { email: string; password: string; captchaToken: string | null };
export type SignInResult = { ok: true; next: "two-step" | "set-up" } | PublicError;

export function signInHandler(input: SignInInput): Promise<SignInResult> {
  return run(async () => {
    memoryGuardIp();
    const email = String(input.email ?? "").trim();
    const password = String(input.password ?? "");
    if (!EMAIL.test(email) || password.length < 1 || password.length > 200) {
      throw new ConsoleError("invalid_input", "Enter your work email and password.");
    }
    await verifyCaptcha(input.captchaToken ?? undefined);
    await checkRateLimit("sign_in", { email, ip: getRequestIP() });

    const { data, error } = await getAnonClient().auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return WRONG_PASSWORD;

    const admin = getAdminClient();
    const { data: roleRow } = await admin
      .from("staff_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!roleRow) {
      // A Linara household account with a correct password: end that session now
      // and answer exactly as for a wrong password.
      await admin.auth.admin.signOut(data.session.access_token);
      return WRONG_PASSWORD;
    }

    writeSessionCookies({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
    const factors = (data.user.factors ?? []) as Factor[];
    const hasTwoStep = factors.some((f) => f.factor_type === "totp" && f.status === "verified");
    return { ok: true as const, next: hasTwoStep ? ("two-step" as const) : ("set-up" as const) };
  });
}

// ---------------------------------------------------------------- Two-step setup

export type SetupResult =
  { ok: true; factorId: string; qrCode: string; secret: string } | PublicError;

export function startTwoStepSetupHandler(): Promise<SetupResult> {
  return run(async () => {
    const staff = await requireStaff(null, { allowAal1: true });
    const client = await getUserClient(staff);
    const { data: list, error: listError } = await client.auth.mfa.listFactors();
    if (listError) throw listError;

    const all = (list?.all ?? []) as Factor[];
    // With only a password, nobody may add a second authenticator to an
    // account that already has one: that would bypass two-step entirely.
    if (all.some((f) => f.factor_type === "totp" && f.status === "verified")) {
      throw new ConsoleError(
        "not_allowed",
        "Two-step sign-in is already set up. Sign in with your code.",
      );
    }
    const removeUnverified = async (factors: Factor[]) => {
      for (const f of factors.filter((f) => f.status === "unverified")) {
        const { error } = await client.auth.mfa.unenroll({ factorId: f.id });
        if (error) throw new Error(`unenroll failed: ${error.message}`);
      }
    };
    const enroll = () =>
      client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Linara Business Console" });

    await removeUnverified(all);
    let { data, error } = await enroll();
    // Two setups at once (a double click, two tabs): the other one created the
    // factor between our list and our enroll. Clear it and try once more.
    if (error && /already exists/i.test(error.message)) {
      const { data: again } = await client.auth.mfa.listFactors();
      await removeUnverified((again?.all ?? []) as Factor[]);
      ({ data, error } = await enroll());
    }
    if (error || !data) throw error ?? new Error("enroll returned nothing");
    return {
      ok: true as const,
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    };
  });
}

// ---------------------------------------------------------------- Two-step code

export type VerifyInput = { code: string; factorId?: string };

export function verifyTwoStepHandler(input: VerifyInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const code = String(input.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) throw new ConsoleError("invalid_input", "Enter the 6-digit code.");

    const staff = await requireStaff(null, { allowAal1: true });
    await checkRateLimit("code", { adminId: staff.userId });

    const client = await getUserClient(staff);
    let factorId = input.factorId;
    if (!factorId) {
      const { data } = await client.auth.mfa.listFactors();
      factorId = (data?.totp as Factor[] | undefined)?.[0]?.id;
      if (!factorId) throw new ConsoleError("not_allowed", "Set up two-step sign-in first.");
    }

    const { data: session, error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error || !session) throw new ConsoleError("invalid_input", WRONG_CODE);

    writeSessionCookies({ accessToken: session.access_token, refreshToken: session.refresh_token });

    const admin = getAdminClient();
    const { data: claimData } = await admin.auth.getClaims(session.access_token);
    const sessionId = (claimData?.claims as { session_id?: string } | undefined)?.session_id;
    if (!sessionId) throw new Error("two-step session has no session_id");
    const { error: startError } = await admin.rpc("staff_start_session", {
      p_session_id: sessionId,
      p_user_id: staff.userId,
    });
    if (startError) throw startError;

    await writeAudit({
      actorId: staff.userId,
      action: "auth.signed_in",
      targetType: "staff",
      targetId: staff.userId,
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- Sign out

export async function signOutHandler(): Promise<{ ok: true }> {
  try {
    const staff = await requireStaff(null, { allowAal1: true });
    await getAdminClient().from("staff_sessions").delete().eq("session_id", staff.sessionId);
    const client = await getUserClient(staff);
    await client.auth.signOut({ scope: "local" });
    await writeAudit({
      actorId: staff.userId,
      action: "auth.signed_out",
      targetType: "staff",
      targetId: staff.userId,
    });
  } catch (e) {
    // Already signed out, or Supabase unreachable: the cookies still go.
    if (!(e instanceof ConsoleError)) logError("sign out", e);
  }
  clearSessionCookies();
  return { ok: true };
}
