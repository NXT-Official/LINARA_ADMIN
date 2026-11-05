import { parseAppEnv, type AppEnv } from "./env";

/**
 * The server's settings, read at request time and checked once. Errors name
 * the variable, never its value, so a misconfigured deploy can't leak a key
 * into a log.
 */
export type ServerEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  siteUrl: string;
  appEnv: AppEnv;
  hcaptchaSecret: string;
  /** Resend API key; without one the console's own emails are skipped (D45). */
  resendApiKey: string | null;
  /** The sender, e.g. `Linara Business Console <notifications@example.com>`. */
  emailFrom: string;
  /** Development and staging only: every console email goes here instead. */
  emailTestRecipient: string | null;
};

/** Resend's shared test sender: delivers only to the Resend account's own email. */
export const RESEND_TEST_FROM = "Linara Business Console <onboarding@resend.dev>";

/** hCaptcha's published test secret: always passes, so never in production. */
const HCAPTCHA_TEST_SECRET = "0x0000000000000000000000000000000000000000";

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const get = (name: string) => (raw[name] ?? "").trim();
  const problems: string[] = [];

  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SITE_URL",
    "HCAPTCHA_SECRET",
  ];
  for (const name of required) if (!get(name)) problems.push(`${name} is missing`);

  for (const name of ["SUPABASE_URL", "SITE_URL"]) {
    if (get(name) && !isUrl(get(name))) problems.push(`${name} isn't a valid http(s) URL`);
  }

  let appEnv: AppEnv = "development";
  try {
    appEnv = parseAppEnv(raw.APP_ENV);
  } catch {
    problems.push("APP_ENV must be development, staging or production");
  }

  if (appEnv === "production") {
    if (get("HCAPTCHA_SECRET") === HCAPTCHA_TEST_SECRET) {
      problems.push("HCAPTCHA_SECRET is the test hCaptcha secret, which production can't use");
    }
    if (isUrl(get("SITE_URL")) && new URL(get("SITE_URL")).protocol !== "https:") {
      problems.push("SITE_URL must use https in production");
    }
    // Production must tell the team about access changes and exports (D45).
    if (!get("RESEND_API_KEY")) problems.push("RESEND_API_KEY is missing");
    if (!get("EMAIL_FROM") || /@resend\.dev>?$/i.test(get("EMAIL_FROM"))) {
      problems.push("EMAIL_FROM must be an address on Linara's own verified domain");
    }
    if (get("EMAIL_TEST_RECIPIENT")) {
      problems.push("EMAIL_TEST_RECIPIENT can't be set in production");
    }
  }

  if (problems.length) throw new Error(`Server settings: ${problems.join("; ")}.`);

  return {
    supabaseUrl: get("SUPABASE_URL").replace(/\/+$/, ""),
    anonKey: get("SUPABASE_ANON_KEY"),
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    siteUrl: get("SITE_URL").replace(/\/+$/, ""),
    appEnv,
    hcaptchaSecret: get("HCAPTCHA_SECRET"),
    resendApiKey: get("RESEND_API_KEY") || null,
    emailFrom: get("EMAIL_FROM") || RESEND_TEST_FROM,
    emailTestRecipient: get("EMAIL_TEST_RECIPIENT") || null,
  };
}

let cached: ServerEnv | undefined;

/** The checked settings for this server instance. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
