import { ConsoleError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";

import { INVOICE_CHANNELS, MAX_SEATS, type InvoiceChannel } from "./billing.types";

/** What staff type into the billing dialogs, checked before it reaches the database. */

const bad = (message: string) => new ConsoleError("invalid_input", message);
const text = (v: unknown) => String(v ?? "").trim();

export type GrantInput = {
  householdId: string;
  planId: string;
  helperSeats: number | null;
  managerSeats: number | null;
  periodEnd: string | null;
  note: string;
  reason: string;
  code: string;
};

export type MarkPaidInput = {
  invoiceId: string;
  channel: InvoiceChannel;
  note: string;
  reason: string;
  code: string;
};

export type RevokeInput = {
  subscriptionId: string;
  reason: string;
  code: string;
};

export function householdIdOf(v: unknown): string {
  if (!isUuid(v)) throw new ConsoleError("not_found", "There's no household with this address.");
  return v;
}

function seats(v: unknown, label: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_SEATS) {
    throw bad(`${label} must be a whole number from 0 to ${MAX_SEATS}, or unlimited.`);
  }
  return v;
}

function reasonOf(v: unknown): string {
  const reason = text(v);
  if (reason.length < 1 || reason.length > 200) throw bad("Give a reason of 1 to 200 characters.");
  return reason;
}

function noteOf(v: unknown): string {
  const note = text(v);
  if (note.length > 500) throw bad("Keep the note to 500 characters.");
  return note;
}

/** A calendar date (YYYY-MM-DD) that exists, or null for no end date. */
function dateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = text(v);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) {
    throw bad("Pick a real end date, or leave it blank.");
  }
  return s;
}

export function parseGrantInput(i: GrantInput) {
  const householdId = householdIdOf(i.householdId);
  if (!isUuid(i.planId)) throw new ConsoleError("not_found", "That plan doesn't exist.");
  return {
    householdId,
    planId: i.planId,
    helperSeats: seats(i.helperSeats, "Helper seats"),
    managerSeats: seats(i.managerSeats, "Manager seats"),
    periodEnd: dateOrNull(i.periodEnd),
    note: noteOf(i.note),
    reason: reasonOf(i.reason),
    code: String(i.code ?? ""),
  };
}

export function parseRevokeInput(i: RevokeInput) {
  if (!isUuid(i.subscriptionId)) {
    throw new ConsoleError("not_found", "That subscription doesn't exist.");
  }
  return {
    subscriptionId: i.subscriptionId,
    reason: reasonOf(i.reason),
    code: String(i.code ?? ""),
  };
}

export function parseMarkPaidInput(i: MarkPaidInput) {
  if (!isUuid(i.invoiceId)) throw new ConsoleError("not_found", "That invoice doesn't exist.");
  if (!INVOICE_CHANNELS.includes(i.channel)) throw bad("Pick how the payment arrived.");
  return {
    invoiceId: i.invoiceId,
    channel: i.channel,
    note: noteOf(i.note),
    reason: reasonOf(i.reason),
    code: String(i.code ?? ""),
  };
}
