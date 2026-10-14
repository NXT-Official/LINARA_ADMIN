/**
 * Headers every response the server sends carries. Ported from LINARA web's
 * src/lib/security-headers.ts and extended for the console (S-14, S-16).
 *
 * - No framing by any site (`frame-ancestors 'none'`, and the older
 *   `X-Frame-Options` for browsers that predate it).
 * - `nosniff`, so a response is only ever read as the type it says it is.
 * - The full URL goes to this site only; other sites get the origin.
 * - Kept out of search engines (spec §7.4). Not relied on for security.
 * - A strict Content-Security-Policy with a per-request nonce for the
 *   router's own scripts, and `no-store` on everything that isn't a static asset.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

const HCAPTCHA = "https://hcaptcha.com https://*.hcaptcha.com";

/**
 * The console's policy (S-14). The browser only ever talks to this site and
 * hCaptcha: every Supabase call happens on the server (D26). Inline styles
 * stay allowed for React's style attributes; inline scripts don't.
 */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${HCAPTCHA}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${HCAPTCHA}`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `frame-src ${HCAPTCHA}`,
    `connect-src 'self' ${HCAPTCHA}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export type SecurityHeaderOptions = {
  /** The request's CSP nonce. Without one, only the framing rule is sent. */
  nonce?: string;
  /** Development: report CSP violations instead of blocking (Vite's dev server needs inline scripts). */
  reportOnly?: boolean;
  /** Pages and server functions: never cached (S-16). Static assets: false. */
  noStore?: boolean;
};

/** The same response with the headers added (a header it already sets wins). */
export function withSecurityHeaders(
  response: Response,
  opts: SecurityHeaderOptions = {},
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (opts.nonce) {
    const csp = buildCsp(opts.nonce);
    if (opts.reportOnly) headers.set("Content-Security-Policy-Report-Only", csp);
    else headers.set("Content-Security-Policy", csp);
  }
  if (opts.noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
