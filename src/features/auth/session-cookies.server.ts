import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import type { SessionTokens } from "@/lib/supabase-user.server";

/**
 * The admin's Supabase session, in two cookies browser code can't read (D26).
 * SameSite=Strict keeps them off requests from other sites. They last at most
 * the 12-hour session cap (D29).
 */
export const ACCESS_COOKIE = "lc_access";
export const REFRESH_COOKIE = "lc_refresh";

const OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 12 * 60 * 60,
};

export function readSessionCookies(): SessionTokens | null {
  const accessToken = getCookie(ACCESS_COOKIE);
  const refreshToken = getCookie(REFRESH_COOKIE);
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export function writeSessionCookies(tokens: SessionTokens): void {
  setCookie(ACCESS_COOKIE, tokens.accessToken, OPTIONS);
  setCookie(REFRESH_COOKIE, tokens.refreshToken, OPTIONS);
}

export function clearSessionCookies(): void {
  deleteCookie(ACCESS_COOKIE, { path: "/" });
  deleteCookie(REFRESH_COOKIE, { path: "/" });
}
