import { ConsoleError } from "@/lib/console-error";
import { getUserClient } from "@/lib/supabase-user.server";

import { checkRateLimit } from "./rate-limit.server";
import { writeSessionCookies } from "./session-cookies.server";
import type { StaffContext } from "./session.server";

const WRONG_CODE = "That code didn't work. Check your authenticator app and try again.";

/**
 * The two-step code again, for a sensitive action (S-5): suspend, process a
 * deletion, export with contact details, add or remove an admin. Shares the
 * code counter with sign-in, so guesses are limited either way (D30).
 */
export async function requireFreshCode(staff: StaffContext, code: string): Promise<void> {
  if (!/^\d{6}$/.test(String(code ?? "").trim())) {
    throw new ConsoleError("invalid_input", "Enter the 6-digit code.");
  }
  await checkRateLimit("code", { adminId: staff.userId });

  const client = await getUserClient(staff);
  const { data: factors } = await client.auth.mfa.listFactors();
  const factorId = (factors?.totp as { id: string }[] | undefined)?.[0]?.id;
  if (!factorId) throw new ConsoleError("not_allowed", "Set up two-step sign-in first.");

  const { data: session, error } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code: code.trim(),
  });
  if (error || !session) throw new ConsoleError("invalid_input", WRONG_CODE);
  // Verifying issues fresh tokens for the same session: keep the newest.
  writeSessionCookies({ accessToken: session.access_token, refreshToken: session.refresh_token });
}
