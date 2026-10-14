/**
 * CSV for data analysts. Opens cleanly in Excel and Google Sheets, and can't
 * run formulas when opened (S-19).
 */

export type CsvValue = string | number | boolean | null | undefined;
export type CsvColumn<T> = { header: string; value: (row: T) => CsvValue };

/** Cells a spreadsheet would read as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  // A leading apostrophe makes the spreadsheet show the text instead of running it.
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  return lines.join("\r\n");
}

/** `linara-users-2026-10-14.csv`, dated in Manila. */
export function csvFilename(slug: string, now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  return `linara-${slug}-${day}.csv`;
}

/** A date as YYYY-MM-DD in Manila, the form spreadsheets sort and parse. */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));
}

export function downloadCsv(filename: string, csv: string) {
  // The byte-order mark makes Excel read the file as UTF-8 (₱, ñ).
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
