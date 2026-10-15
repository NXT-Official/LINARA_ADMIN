import { getRequestIP } from "@tanstack/react-start/server";

import { ConsoleError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { serverEnv } from "@/lib/server-env.server";

const CAPTCHA_FAILED = "Complete the captcha check, then try again.";

/**
 * Checks an hCaptcha token on the server (S-3). Not a Supabase call, so it
 * runs before the database rate limit. Fails closed if hCaptcha can't be reached.
 */
export async function verifyCaptcha(token: string | undefined): Promise<void> {
  if (!token) throw new ConsoleError("invalid_input", CAPTCHA_FAILED);

  const body = new URLSearchParams({ secret: serverEnv().hcaptchaSecret, response: token });
  const ip = getRequestIP();
  if (ip) body.set("remoteip", ip);

  try {
    const res = await fetch("https://api.hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    const result = (await res.json()) as { success?: boolean };
    if (result.success === true) return;
  } catch (e) {
    logError("hCaptcha", e);
  }
  throw new ConsoleError("invalid_input", CAPTCHA_FAILED);
}
