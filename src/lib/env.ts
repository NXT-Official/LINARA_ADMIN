/**
 * Which deployment this is (NFR-8). Baked in at build time by vite.config.ts,
 * so the browser and the server agree, and shown on every screen.
 */
export const APP_ENVS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/**
 * An unset value is development, so a fresh checkout runs. Anything else that
 * isn't a known environment fails the build's first render instead of
 * quietly showing the wrong badge.
 */
export function parseAppEnv(raw: string | undefined): AppEnv {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "development";
  const match = APP_ENVS.find((env) => env === value);
  if (!match) throw new Error(`APP_ENV must be one of ${APP_ENVS.join(", ")}; got "${raw}"`);
  return match;
}

export const APP_ENV: AppEnv = parseAppEnv(process.env.APP_ENV);

export const APP_ENV_LABEL: Record<AppEnv, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
};
