import { SOURCE_LABEL } from "@/data/labels";

import { normalisePhone, parseLeadInput, type LeadInput } from "./crm.input";
import { SOURCES, type ContactSource } from "./crm.types";

/**
 * Turning a spreadsheet into leads (FR-CRM-10): guess which column is which,
 * check every row the way the server will, and flag duplicates so the admin
 * decides. The server checks every row again before anything is saved.
 */

export const IMPORT_FIELDS = ["fullName", "email", "phone", "source", "tags", "note"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Partial<Record<ImportField, number>>;

export const MAX_IMPORT_ROWS = 500;

const HEADER_WORDS: Record<ImportField, string[]> = {
  fullName: ["name", "fullname", "contactname"],
  email: ["email", "emailaddress"],
  phone: ["phone", "mobile", "number", "phonenumber", "mobilenumber", "cellphone", "contact"],
  source: ["source", "where", "wherefrom", "channel"],
  tags: ["tags", "tag", "labels", "label"],
  note: ["notes", "note", "remarks", "comments"],
};

export function guessMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const words = headers.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  for (const field of IMPORT_FIELDS) {
    const at = words.findIndex(
      (w, i) => HEADER_WORDS[field].includes(w) && !Object.values(mapping).includes(i),
    );
    if (at >= 0) mapping[field] = at;
  }
  return mapping;
}

/** A source written as its code or its label ("Walk-in", "walk in"); "unknown" when neither. */
export function parseSource(raw: string): ContactSource | null | "unknown" {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key) return null;
  const byCode = SOURCES.find((s) => s === key);
  if (byCode) return byCode;
  const byLabel = SOURCES.find(
    (s) => SOURCE_LABEL[s].toLowerCase().replace(/[\s-]+/g, "_") === key,
  );
  return byLabel ?? "unknown";
}

/** A cell a spreadsheet would run as a formula is kept as text (S-19). */
const FORMULA_START = /^[=+\-@\t\r]/;
const neutral = (v: string) => (FORMULA_START.test(v) ? `'${v}` : v);

export type ImportRow = {
  /** The spreadsheet's line number: the header is line 1. */
  line: number;
  input: LeadInput;
  errors: string[];
  duplicateOf: "file" | "saved" | null;
  include: boolean;
};

const emailKey = (v: string | null | undefined) => (v ? v.trim().toLowerCase() : null);
const phoneKey = (v: string | null | undefined) => (v ? (normalisePhone(v) ?? v.trim()) : null);

export function buildImportRows(
  table: string[][],
  mapping: ImportMapping,
  saved: { email: string | null; phone: string | null }[],
): ImportRow[] {
  const cell = (row: string[], field: ImportField) => {
    const at = mapping[field];
    return at === undefined ? "" : (row[at] ?? "").trim();
  };
  const data = table
    .slice(1)
    .map((row, i) => ({ row, line: i + 2 }))
    .filter(({ row }) => IMPORT_FIELDS.some((f) => cell(row, f) !== ""));
  if (data.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  }

  const rows: ImportRow[] = data.map(({ row, line }) => {
    const source = parseSource(cell(row, "source"));
    const input: LeadInput = {
      fullName: neutral(cell(row, "fullName")),
      email: cell(row, "email"),
      phone: cell(row, "phone"),
      source: source === "unknown" ? null : source,
      tags: cell(row, "tags"),
      note: neutral(cell(row, "note")),
    };
    const errors: string[] = [];
    if (source === "unknown") errors.push("Pick a known source.");
    try {
      parseLeadInput(input);
    } catch (e) {
      errors.push((e as { publicMessage?: string }).publicMessage ?? "Check this row.");
    }
    return { line, input, errors, duplicateOf: null, include: true };
  });

  // Duplicates: the same email (any case) or phone twice in the file, or a saved contact.
  const count = new Map<string, number>();
  const keys = (r: ImportRow) =>
    [emailKey(r.input.email), phoneKey(r.input.phone)].filter((k): k is string => !!k);
  for (const r of rows) for (const k of keys(r)) count.set(k, (count.get(k) ?? 0) + 1);
  const known = new Set(
    saved.flatMap((s) => [emailKey(s.email), phoneKey(s.phone)]).filter((k): k is string => !!k),
  );
  for (const r of rows) {
    const k = keys(r);
    r.duplicateOf = k.some((x) => (count.get(x) ?? 0) > 1)
      ? "file"
      : k.some((x) => known.has(x))
        ? "saved"
        : null;
    r.include = r.duplicateOf === null;
  }
  return rows;
}
