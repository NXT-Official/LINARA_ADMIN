import { ConsoleError } from "./console-error";

/** Input checks shared by the paged lists (NFR-7, D31, S-20). */

export const PAGE_SIZE = 50;
export const MAX_PAGE = 200; // 10,000 rows back

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The page number, refusing far-off pages: a deep offset is a slow scan. */
export function parsePage(page: unknown): number {
  const n = Math.max(0, Math.floor(Number(page) || 0));
  if (n > MAX_PAGE) throw new ConsoleError("invalid_input", "Narrow the search to see more.");
  return n;
}

/** A trimmed search term of 2 to 100 characters, or null for no search. */
export function parseSearch(search: unknown): string | null {
  const term = String(search ?? "").trim();
  if (term === "") return null;
  if (term.length < 2 || term.length > 100) {
    throw new ConsoleError("invalid_input", "Search with 2 to 100 characters.");
  }
  return term;
}

/** The limit and offset for a page, with one extra row to tell if there's more. */
export function pageWindow(page: number): { p_limit: number; p_offset: number } {
  return { p_limit: PAGE_SIZE + 1, p_offset: page * PAGE_SIZE };
}
