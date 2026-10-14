/**
 * Headers every response the server sends carries. Ported from LINARA web's
 * src/lib/security-headers.ts.
 *
 * - No framing by any site (`frame-ancestors 'none'`, and the older
 *   `X-Frame-Options` for browsers that predate it).
 * - `nosniff`, so a response is only ever read as the type it says it is.
 * - The full URL goes to this site only; other sites get the origin.
 * - Kept out of search engines (spec §7.4). Not relied on for security.
 *
 * The full Content-Security-Policy (S-14) and `no-store` on authenticated
 * responses (S-16) come with sign-in in Phase 1.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

/** The same response with the headers added (a header it already sets wins). */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
