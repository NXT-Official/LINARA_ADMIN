/**
 * The only errors the browser ever sees (spec §10): a code and a plain
 * message. Never a stack trace or a database detail.
 */
export type ConsoleErrorCode =
  "not_signed_in" | "not_allowed" | "not_found" | "conflict" | "outside_service" | "invalid_input";

const DEFAULT_MESSAGE: Record<ConsoleErrorCode, string> = {
  not_signed_in: "Sign in to continue.",
  not_allowed: "Your role doesn't allow this.",
  not_found: "That record doesn't exist.",
  conflict: "That can't be done right now.",
  outside_service: "Something went wrong on our side. Try again.",
  invalid_input: "Check what you entered and try again.",
};

export class ConsoleError extends Error {
  readonly code: ConsoleErrorCode;
  readonly publicMessage: string;

  constructor(code: ConsoleErrorCode, publicMessage?: string) {
    super(publicMessage ?? DEFAULT_MESSAGE[code]);
    this.name = "ConsoleError";
    this.code = code;
    this.publicMessage = publicMessage ?? DEFAULT_MESSAGE[code];
  }
}

export type PublicError = { ok: false; code: ConsoleErrorCode; message: string };

/** What a server function returns for any error: unknown errors say nothing about themselves. */
export function toPublicError(e: unknown): PublicError {
  if (e instanceof ConsoleError) return { ok: false, code: e.code, message: e.publicMessage };
  return { ok: false, code: "outside_service", message: DEFAULT_MESSAGE.outside_service };
}
