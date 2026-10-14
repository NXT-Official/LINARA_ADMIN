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
};

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
  }

  if (problems.length) throw new Error(`Server settings: ${problems.join("; ")}.`);

  return {
    supabaseUrl: get("SUPABASE_URL").replace(/\/+$/, ""),
    anonKey: get("SUPABASE_ANON_KEY"),
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    siteUrl: get("SITE_URL").replace(/\/+$/, ""),
    appEnv,
    hcaptchaSecret: get("HCAPTCHA_SECRET"),
  };
}

let cached: ServerEnv | undefined;

/** The checked settings for this server instance. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
