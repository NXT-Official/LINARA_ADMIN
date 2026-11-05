import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

/**
 * The caller's address, for the per-IP rate limits and hCaptcha (D30, S-3).
 *
 * On Vercel the socket is Vercel's own proxy, so every caller would share one
 * address. Vercel builds `X-Forwarded-For` itself from the incoming connection
 * and discards whatever a client sent, so its leftmost entry is the real
 * client (vercel.com/docs/headers/request-headers). `x-real-ip` isn't
 * documented as overwritten, so it isn't trusted.
 *
 * Anywhere else (local, tests) a client can set that header to anything, so
 * only the socket address counts there.
 */
export function clientIp(): string | undefined {
  if (process.env.VERCEL === "1") {
    const first = getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return getRequestIP() ?? undefined;
}
