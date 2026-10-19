import { ConsoleError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";

import { DEFAULT_CATEGORY, FAQ_LIMITS, type FaqInput } from "./faq.types";

/** What staff type into a FAQ, checked before it reaches the database. */

const bad = (message: string) => new ConsoleError("invalid_input", message);
const text = (v: unknown) => String(v ?? "").trim();

export function parseFaqId(v: unknown): string {
  if (!isUuid(v)) throw bad("Pick a question from the list.");
  return v;
}

export function parseFaqInput(input: FaqInput) {
  const question = text(input.question);
  if (question.length < 1 || question.length > FAQ_LIMITS.question) {
    throw bad(`Write a question of up to ${FAQ_LIMITS.question} characters.`);
  }
  const answer = text(input.answer);
  if (answer.length < 1 || answer.length > FAQ_LIMITS.answer) {
    throw bad("Write an answer of up to 4,000 characters.");
  }
  const category = text(input.category) || DEFAULT_CATEGORY;
  if (category.length > FAQ_LIMITS.category) {
    throw bad(`Keep the category to ${FAQ_LIMITS.category} characters.`);
  }
  const sortOrder = input.sortOrder;
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 999_999_999) {
    throw bad("The order must be a whole number.");
  }
  if (typeof input.published !== "boolean") throw bad("Choose published or draft.");
  const id = input.id === null || input.id === undefined ? null : parseFaqId(input.id);
  return { id, question, answer, category, sortOrder, published: input.published };
}
