import { ConsoleError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";

import {
  COST_CATEGORIES,
  type CostCategory,
  type CostInput,
  type ModelPrice,
} from "./finance.types";

/** What staff type into Finance, checked before it reaches the database. */

const bad = (message: string) => new ConsoleError("invalid_input", message);
const text = (v: unknown) => String(v ?? "").trim();

const MAX_MONEY = 100_000_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(v: unknown): string | null {
  if (typeof v !== "string" || !DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function parseRange(input: { from: unknown; to: unknown }): { from: string; to: string } {
  const from = realDate(input?.from);
  const to = realDate(input?.to);
  if (!from || !to) throw bad("Pick both dates.");
  if (from > to) throw bad("Choose a start date on or before the end date.");
  return { from, to };
}

export function costId(v: unknown): string {
  if (!isUuid(v)) throw new ConsoleError("not_found", "That cost doesn't exist.");
  return v;
}

function money(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_MONEY) {
    throw bad(`${label} must be a whole number of centavos, zero or more.`);
  }
  return v;
}

export function parseCostInput(input: CostInput): CostInput {
  const month = realDate(input?.month);
  if (!month || !month.endsWith("-01")) throw bad("Pick a month.");
  if (!COST_CATEGORIES.includes(input.category as CostCategory)) throw bad("Pick a category.");
  const label = text(input.label);
  if (!label || label.length > 120) throw bad("Give the cost a label of up to 120 characters.");
  const note = text(input.note);
  if (note.length > 300) throw bad("Keep the note to 300 characters.");
  if (input.id !== undefined && !isUuid(input.id)) {
    throw new ConsoleError("not_found", "That cost doesn't exist.");
  }
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    month,
    category: input.category,
    label,
    amountCentavos: money(input.amountCentavos, "The amount"),
    note: note === "" ? null : note,
  };
}

export function parseModelPrice(input: ModelPrice): ModelPrice {
  const model = text(input?.model);
  if (!model || model.length > 80) throw bad("Give the model a name of up to 80 characters.");
  const note = text(input.note);
  if (note.length > 300) throw bad("Keep the note to 300 characters.");
  return {
    model,
    inputCentavosPer1m: money(input.inputCentavosPer1m, "The input price"),
    outputCentavosPer1m: money(input.outputCentavosPer1m, "The output price"),
    audioCentavosPerMinute: money(input.audioCentavosPerMinute, "The audio price"),
    note: note === "" ? null : note,
  };
}
