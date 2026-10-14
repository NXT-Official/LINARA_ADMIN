/**
 * Server logging that never prints personal data (S-21): emails, Philippine
 * phone numbers and peso amounts are replaced before anything is written.
 */
// Bounded, non-overlapping parts so a long crafted string can't make it backtrack (ReDoS).
// The safe-regex rule flags any quantified group; these can't backtrack badly.
// eslint-disable-next-line security/detect-unsafe-regex
const EMAIL = /[\w.%+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const PHONE = /(?:\+639|09)\d{9}\b/g;
// eslint-disable-next-line security/detect-unsafe-regex
const PESO = /₱\s?[\d,]+(?:\.\d{1,2})?/g;

export function scrub(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(PESO, "[amount]");
}

export function logError(context: string, error: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error ?? "");
  console.error(`[console] ${context}: ${scrub(detail)}`);
}
