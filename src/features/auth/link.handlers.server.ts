import { getRequestIP } from "@tanstack/react-start/server";

import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { serverEnv } from "@/lib/server-env.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { getAnonClient, getUserClient } from "@/lib/supabase-user.server";

import { WRONG_PASSWORD } from "./auth.handlers.server";
import { verifyCaptcha } from "./captcha.server";
import { checkRateLimit, memoryGuardIp } from "./rate-limit.server";
import { writeSessionCookies } from "./session-cookies.server";

/** Password reset and accepting an admin invite (S-4, S-7, FR-TM-2). */

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const LINK_EXPIRED = "This link has expired or was already used. Ask for a new one.";
const MIN_PASSWORD = 12;

async function isConsoleAdmin(userId: string): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("staff_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------- Request a reset

export type ResetInput = { email: string; captchaToken: string | null };

/**
 * Always answers `{ ok: true }` once the captcha passes: for an unknown email,
 * a household account, a rate-limited address or a Supabase error alike, so
 * the form can't be used to learn which emails exist (S-4). Only console
 * admins are sent an email, so it can't be used to spam Linara households.
 */
export async function requestPasswordResetHandler(
  input: ResetInput,
): Promise<{ ok: true } | PublicError> {
  try {
    memoryGuardIp();
    const email = String(input.email ?? "").trim();
    if (!EMAIL.test(email)) throw new ConsoleError("invalid_input", "Enter your work email.");
    await verifyCaptcha(input.captchaToken ?? undefined);
  } catch (e) {
    return toPublicError(e);
  }

  const email = String(input.email).trim();
  try {
    await checkRateLimit("reset", { email, ip: getRequestIP() });
    const { data } = await getAdminClient().rpc("staff_lookup_user", { p_email: email });
    const user = (data as { user_id: string }[] | null)?.[0];
    if (!user || !(await isConsoleAdmin(user.user_id))) return { ok: true };

    const { error } = await getAnonClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${serverEnv().siteUrl}/reset-password`,
    });
    if (error) logError("reset email", error.message);
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("reset", e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- Set a password from a link

export type LinkInput = {
  accessToken: string;
  refreshToken: string;
  password: string;
  purpose: "recovery" | "invite";
};
export type LinkResult = { ok: true; next: "/sign-in" | "/sign-in/set-up" } | PublicError;

export async function setPasswordFromLinkHandler(input: LinkInput): Promise<LinkResult> {
  try {
    memoryGuardIp();
    if (String(input.password ?? "").length < MIN_PASSWORD) {
      throw new ConsoleError("invalid_input", "Use at least 12 characters.");
    }
    if (String(input.password).length > 200) {
      throw new ConsoleError("invalid_input", "Use at most 200 characters.");
    }
    await checkRateLimit("link", { ip: getRequestIP() });

    const { data: claimData, error: claimError } = await getAdminClient().auth.getClaims(
      input.accessToken,
    );
    const userId = (claimData?.claims as { sub?: string } | undefined)?.sub;
    if (claimError || !userId) throw new ConsoleError("invalid_input", LINK_EXPIRED);

    // Both kinds of link only work for console admins.
    if (!(await isConsoleAdmin(userId))) return WRONG_PASSWORD;

    const tokens = { accessToken: input.accessToken, refreshToken: input.refreshToken };
    const client = await getUserClient(tokens).catch(() => {
      throw new ConsoleError("invalid_input", LINK_EXPIRED);
    });
    const { error } = await client.auth.updateUser({ password: input.password });
    if (error)
      throw new ConsoleError(
        "invalid_input",
        error.message.includes("same")
          ? "Choose a password you haven't used here before."
          : "That password can't be used. Try another.",
      );

    if (input.purpose === "invite") {
      // Signed in at aal1: the next screen sets up two-step sign-in.
      writeSessionCookies(tokens);
      return { ok: true, next: "/sign-in/set-up" };
    }
    // A reset link's session ends here: the admin signs in with the new password and their code.
    await client.auth.signOut({ scope: "local" });
    return { ok: true, next: "/sign-in" };
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("set password", e);
    return toPublicError(e);
  }
}
