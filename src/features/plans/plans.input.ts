import { ConsoleError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";

import {
  PLAN_INTERVALS,
  PLAN_STATUSES,
  type BillingSettings,
  type PlanInput,
  type PlanStatus,
} from "./plans.types";

/** What staff type into a plan or the free tier, checked before it reaches the database. */

const bad = (message: string) => new ConsoleError("invalid_input", message);
const text = (v: unknown) => String(v ?? "").trim();

const MAX_MONEY = 1_000_000_000_000;
const MAX_INT = 2_147_483_647;

function whole(v: unknown, label: string, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) {
    throw bad(`${label} must be a whole number, zero or more.`);
  }
  return v;
}

/** A seat limit or an extra price: null means unlimited or not sold. */
function wholeOrNull(v: unknown, label: string, max: number): number | null {
  return v === null || v === undefined ? null : whole(v, label, max);
}

export function planId(v: unknown): string {
  if (!isUuid(v)) throw new ConsoleError("not_found", "That plan doesn't exist.");
  return v;
}

export function parsePlanStatus(v: unknown): PlanStatus {
  if (!PLAN_STATUSES.includes(v as PlanStatus)) throw bad("Pick draft, active or archived.");
  return v as PlanStatus;
}

export function parsePlanInput(input: PlanInput): PlanInput {
  const name = text(input.name);
  if (!name || name.length > 60) throw bad("Give the plan a name of up to 60 characters.");
  const tagline = text(input.tagline);
  if (tagline.length > 200) throw bad("Keep the tagline to 200 characters.");
  if (!Array.isArray(input.inclusions)) throw bad("List what is included, one per line.");
  const inclusions = input.inclusions.map(text).filter((l) => l !== "");
  if (inclusions.length > 20) throw bad("A plan can list 20 inclusions at most.");
  if (inclusions.some((l) => l.length > 200)) {
    throw bad("Keep each inclusion to 200 characters.");
  }
  if (!PLAN_INTERVALS.includes(input.interval)) throw bad("Pick one-time, monthly or yearly.");
  if (typeof input.isPublic !== "boolean") throw bad("Say whether the plan shows publicly.");
  if (input.id !== undefined && !isUuid(input.id)) {
    throw new ConsoleError("not_found", "That plan doesn't exist.");
  }
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    name,
    tagline,
    inclusions,
    interval: input.interval,
    baseCentavos: whole(input.baseCentavos, "The base price", MAX_MONEY),
    includedHelpers: wholeOrNull(input.includedHelpers, "Included helpers", MAX_INT),
    includedManagers: wholeOrNull(input.includedManagers, "Included managers", MAX_INT),
    includedHomes: wholeOrNull(input.includedHomes, "Included homes", MAX_INT),
    extraHelperCentavos: wholeOrNull(
      input.extraHelperCentavos,
      "The extra helper price",
      MAX_MONEY,
    ),
    extraManagerCentavos: wholeOrNull(
      input.extraManagerCentavos,
      "The extra manager price",
      MAX_MONEY,
    ),
    extraHomeCentavos: wholeOrNull(input.extraHomeCentavos, "The extra home price", MAX_MONEY),
    trialDays: whole(input.trialDays, "The trial length", 3650),
    isPublic: input.isPublic,
    sortOrder: whole(input.sortOrder, "The order", MAX_INT),
  };
}

export function parseBillingSettings(input: BillingSettings): BillingSettings {
  if (typeof input.freeTierEnabled !== "boolean") throw bad("Say whether the free tier is on.");
  const email = text(input.supportEmail);
  if (email.length > 254 || (email !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw bad("The support email doesn't look like an email address.");
  }
  return {
    freeTierEnabled: input.freeTierEnabled,
    freeHelperSeats: wholeOrNull(input.freeHelperSeats, "Free helper seats", MAX_INT),
    freeManagerSeats: wholeOrNull(input.freeManagerSeats, "Free manager seats", MAX_INT),
    supportEmail: email === "" ? null : email,
  };
}
