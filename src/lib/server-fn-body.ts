/** Where TanStack Start serves server functions. */
export const SERVER_FN_PREFIX = "/_serverFn/";

/**
 * A JSON server-function call whose body the framework would choke on.
 *
 * The browser always sends a serialized object with a `t` member (TanStack
 * Start's serverFnFetcher), even for a function without input. An empty body,
 * text that isn't JSON, or JSON of another shape only comes from someone
 * calling the endpoint by hand; the framework answered those with a 500 and
 * its own error text (2026-11-02 test). Other content types (form uploads)
 * are left to the framework.
 */
export function isMalformedServerFnBody(contentType: string | null, body: string): boolean {
  if (!contentType?.toLowerCase().includes("application/json")) return false;
  if (!body.trim()) return true;
  try {
    const value = JSON.parse(body) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
    const t = (value as { t?: unknown }).t;
    return typeof t !== "object" || t === null;
  } catch {
    return true;
  }
}

/** The answer to a malformed call: a plain 400, with nothing about the framework in it. */
export function badRequest(): Response {
  return new Response(JSON.stringify({ error: "bad_request" }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
