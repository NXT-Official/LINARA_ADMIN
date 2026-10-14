/** Server function calls, which the CSRF check covers (start.ts). Pages and assets aren't. */
export function isServerFnRequest(url: string): boolean {
  return new URL(url).pathname.startsWith("/_serverFn/");
}
