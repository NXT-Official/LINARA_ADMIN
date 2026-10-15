import { ConsoleError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";

import {
  ACTIVITY_KINDS,
  LEAD_STAGES,
  SOURCES,
  type ActivityKind,
  type ContactSource,
  type LeadStage,
} from "./crm.types";

/**
 * What admins type into the CRM, checked and cleaned before it reaches the
 * database (FR-CRM-1, FR-CRM-2, FR-CRM-5, FR-CRM-7 to FR-CRM-9). The SQL
 * checks the same limits again.
 */

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const TAG = /^[A-Za-z0-9 _-]{1,30}$/;
const DAY_MS = 86_400_000;

const bad = (message: string) => new ConsoleError("invalid_input", message);
const text = (v: unknown) => String(v ?? "").trim();

/** A Philippine mobile number as 09XXXXXXXXX, or null if it isn't one. */
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/[\s()-]/g, "");
  if (digits.startsWith("+63")) digits = `0${digits.slice(3)}`;
  else if (/^63\d{10}$/.test(digits)) digits = `0${digits.slice(2)}`;
  return /^09\d{9}$/.test(digits) ? digits : null;
}

/** Comma-separated or listed tags: trimmed, first spelling kept, at most 10. */
export function normaliseTags(raw: string[] | string | null | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of parts) {
    if (!TAG.test(t)) throw bad("Tags are up to 30 letters, numbers, spaces or dashes.");
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    tags.push(t);
  }
  if (tags.length > 10) throw bad("Use at most 10 tags.");
  return tags;
}

function parseOwner(ownerId: unknown): string | null {
  if (ownerId === null || ownerId === undefined || ownerId === "") return null;
  if (!isUuid(ownerId)) throw bad("Pick an owner from the list.");
  return ownerId;
}

export type LeadInput = {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  source?: ContactSource | null;
  ownerId?: string | null;
  tags?: string[] | string | null;
  note?: string | null;
};

export type CleanLead = {
  fullName: string;
  email: string | null;
  phone: string | null;
  source: ContactSource | null;
  ownerId: string | null;
  tags: string[];
  note: string | null;
};

export function parseLeadInput(input: LeadInput): CleanLead {
  const fullName = text(input.fullName);
  if (fullName.length < 1 || fullName.length > 120)
    throw bad("Enter a name of up to 120 characters.");

  const emailRaw = text(input.email).toLowerCase();
  if (emailRaw && !EMAIL.test(emailRaw)) throw bad("Enter a valid email.");
  const phoneRaw = text(input.phone);
  const phone = phoneRaw ? normalisePhone(phoneRaw) : null;
  if (phoneRaw && !phone) throw bad("Enter the phone number as 09XXXXXXXXX.");
  if (!emailRaw && !phone) throw bad("A lead needs an email or a phone number.");

  const source = input.source ?? null;
  if (source !== null && !SOURCES.includes(source)) throw bad("Pick where they came from.");

  const note = text(input.note);
  if (note.length > 2000) throw bad("Keep the note to 2,000 characters.");

  return {
    fullName,
    email: emailRaw || null,
    phone,
    source,
    ownerId: parseOwner(input.ownerId),
    tags: normaliseTags(input.tags),
    note: note || null,
  };
}

export function parseOwnerAndTags(input: {
  ownerId?: string | null;
  tags?: string[] | string | null;
}): { ownerId: string | null; tags: string[] } {
  return { ownerId: parseOwner(input.ownerId), tags: normaliseTags(input.tags) };
}

export function parseLeadStage(
  stage: unknown,
  lostReason: unknown,
): {
  stage: LeadStage;
  lostReason: string | null;
} {
  if (!LEAD_STAGES.includes(stage as LeadStage)) throw bad("Pick a stage.");
  const reason = text(lostReason);
  if (stage === "lost" && !reason) throw bad("Say why the lead was lost.");
  if (reason.length > 300) throw bad("Keep the reason to 300 characters.");
  return { stage: stage as LeadStage, lostReason: stage === "lost" ? reason : null };
}

export type ActivityInput = { kind: ActivityKind; body: string; occurredAt: string };

export function parseActivityInput(input: ActivityInput, now: Date = new Date()): ActivityInput {
  if (!ACTIVITY_KINDS.includes(input.kind)) throw bad("Pick the kind of activity.");
  const body = text(input.body);
  if (!body) throw bad("Write what was said or done.");
  if (body.length > 2000) throw bad("Keep it to 2,000 characters.");
  const at = Date.parse(input.occurredAt);
  if (Number.isNaN(at)) throw bad("Pick when it happened.");
  if (at > now.getTime() + 5 * 60_000) throw bad("An activity can't be in the future.");
  return { kind: input.kind, body, occurredAt: new Date(at).toISOString() };
}

export type FollowUpInput = { dueAt: string; note: string; assigneeId: string };

export function parseFollowUpInput(input: FollowUpInput, now: Date = new Date()): FollowUpInput {
  const note = text(input.note);
  if (!note) throw bad("Write what to do.");
  if (note.length > 2000) throw bad("Keep it to 2,000 characters.");
  const due = Date.parse(input.dueAt);
  if (Number.isNaN(due)) throw bad("Pick a due date.");
  if (due > now.getTime() + 365 * DAY_MS) throw bad("Pick a due date within a year.");
  if (!isUuid(input.assigneeId)) throw bad("Pick who does it.");
  return { note, dueAt: new Date(due).toISOString(), assigneeId: input.assigneeId };
}
