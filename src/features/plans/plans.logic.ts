import type { ChipTone } from "@/components/shared/status-chip";

import { FEATURES, LIMIT_LABEL } from "./plans.sample";
import {
  CYCLES,
  LIMIT_KEYS,
  type Addon,
  type CatalogState,
  type Cycle,
  type FeatureKey,
  type LimitKey,
  type Plan,
  type PlanContent,
  type PlanStatus,
  type SwitchKey,
} from "./plans.types";

/** ₱999,999.99, the most any one price can be. */
export const MAX_CENTAVOS = 99_999_999;
export const MAX_TRIAL_DAYS = 90;
export const MAX_NAME = 40;
export const MAX_DESCRIPTION = 160;
const LIMIT_RANGE: Record<LimitKey, [number, number]> = {
  households: [1, 99],
  kasambahay: [1, 99],
  co_managers: [0, 20],
};

export type PesoParse = { ok: true; centavos: number } | { ok: false; message: string };

/**
 * A peso amount as typed ("1,299.50", "₱100", "0") to whole centavos. Refuses
 * anything that isn't plainly a non-negative amount with at most two decimals,
 * so a stray letter or a third decimal never turns into a different price.
 */
export function parsePeso(input: string): PesoParse {
  const raw = input.trim().replace(/^₱\s*/, "");
  if (raw === "") return { ok: false, message: "Enter a price." };
  const bad: PesoParse = { ok: false, message: "Enter a price in pesos, like 199 or 1,299.50." };
  // Checked piece by piece rather than with one nested pattern (no backtracking).
  const parts = raw.split(".");
  if (parts.length > 2) return bad;
  const [grouped, frac = ""] = parts;
  if (parts.length === 2 && !/^\d{1,2}$/.test(frac)) return bad;
  const groups = grouped.split(",");
  const wholeOk =
    groups.length === 1
      ? /^\d+$/.test(groups[0])
      : /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
  if (!wholeOk) return bad;
  const whole = groups.join("");
  const centavos = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos) || centavos > MAX_CENTAVOS) {
    return { ok: false, message: "That's more than ₱999,999.99." };
  }
  return { ok: true, centavos };
}

/** Centavos as the field shows them: "1299.50", "100". */
export function centavosToInput(centavos: number | null): string {
  if (centavos === null) return "";
  const pesos = Math.floor(centavos / 100);
  const rest = centavos % 100;
  return rest === 0 ? String(pesos) : `${pesos}.${String(rest).padStart(2, "0")}`;
}

export const CYCLE_LABEL: Record<Cycle, { field: string; per: string }> = {
  monthly: { field: "Monthly", per: "a month" },
  annual: { field: "Yearly", per: "a year" },
  one_time: { field: "One-time", per: "once" },
};

const pesoFmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const wholePesoFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
/** "₱199", "₱1,299.50": centavos only when there are some. */
export function formatCentavos(centavos: number): string {
  return (centavos % 100 === 0 ? wholePesoFmt : pesoFmt).format(centavos / 100);
}

/** "₱0 a month", "₱199 a month, ₱1,990 a year", or "Not priced". */
export function priceSummary(content: PlanContent): string {
  const parts = CYCLES.filter((c) => content.prices[c] !== null).map(
    (c) => `${formatCentavos(content.prices[c] as number)} ${CYCLE_LABEL[c].per}`,
  );
  return parts.length ? parts.join(", ") : "Not priced";
}

export function limitText(key: LimitKey, value: number | null): string {
  const l = LIMIT_LABEL[key];
  if (value === null) return `Unlimited ${l.many}`;
  return `${value} ${value === 1 ? l.one : l.many}`;
}

export function limitsSummary(content: PlanContent): string {
  return LIMIT_KEYS.map((k) => limitText(k, content.limits[k])).join(", ");
}

export type ContentErrors = Partial<
  Record<"name" | "description" | "trialDays" | "prices" | Cycle | LimitKey, string>
>;

/** What's wrong with a plan's content, by field. Empty when it can be saved. */
export function validateContent(
  content: PlanContent,
  others: Plan[],
  opts: { forPublish?: boolean } = {},
): ContentErrors {
  const errors: ContentErrors = {};
  const name = content.name.trim();
  if (!name) errors.name = "Give the plan a name.";
  else if ([...name].length > MAX_NAME) errors.name = `Keep the name to ${MAX_NAME} characters.`;
  else if (others.some((p) => p.content.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = "Another plan already has this name.";
  }
  if ([...content.description].length > MAX_DESCRIPTION) {
    errors.description = `Keep the description to ${MAX_DESCRIPTION} characters.`;
  }
  if (
    !Number.isInteger(content.trialDays) ||
    content.trialDays < 0 ||
    content.trialDays > MAX_TRIAL_DAYS
  ) {
    errors.trialDays = `A trial is 0 to ${MAX_TRIAL_DAYS} whole days.`;
  }
  for (const c of CYCLES) {
    const v = content.prices[c];
    if (v !== null && (!Number.isSafeInteger(v) || v < 0 || v > MAX_CENTAVOS)) {
      errors[c] = "Enter a price from ₱0 to ₱999,999.99.";
    }
  }
  if (opts.forPublish && CYCLES.every((c) => content.prices[c] === null)) {
    errors.prices = "Set at least one price before publishing. A free plan is ₱0 a month.";
  }
  for (const k of LIMIT_KEYS) {
    const v = content.limits[k];
    const [min, max] = LIMIT_RANGE[k];
    if (v !== null && (!Number.isInteger(v) || v < min || v > max)) {
      errors[k] = `${LIMIT_LABEL[k].field}: ${min} to ${max}, or unlimited.`;
    }
  }
  return errors;
}

/** The fields that differ, as the version history describes them. */
export function describeChanges(before: PlanContent, after: PlanContent): string {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push("name");
  if (before.description !== after.description) changed.push("description");
  if (CYCLES.some((c) => before.prices[c] !== after.prices[c])) changed.push("prices");
  if (before.trialDays !== after.trialDays) changed.push("trial");
  if (FEATURES.some((f) => before.features[f.key] !== after.features[f.key])) {
    changed.push("features");
  }
  if (LIMIT_KEYS.some((k) => before.limits[k] !== after.limits[k])) changed.push("limits");
  if (changed.length === 0) return "No changes";
  const list =
    changed.length === 1
      ? changed[0]
      : `${changed.slice(0, -1).join(", ")} and ${changed[changed.length - 1]}`;
  return `Changed ${list}`;
}

export function sameContent(a: PlanContent, b: PlanContent): boolean {
  return describeChanges(a, b) === "No changes";
}

/** A plan that has been published keeps a version per saved change. */
export function isVersioned(plan: Plan): boolean {
  return plan.versions.length > 0;
}

export function currentVersion(plan: Plan): number {
  return plan.versions[0]?.version ?? 0;
}

export const PLAN_TONE: Record<PlanStatus, ChipTone> = {
  draft: "neutral",
  published: "done",
  hidden: "late",
  retired: "quiet",
};

export const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  published: "Published",
  hidden: "Hidden",
  retired: "Retired",
};

/** The status changes the plan page offers, with the words on the button. */
export function statusMoves(plan: Plan): { to: PlanStatus; label: string }[] {
  switch (plan.status) {
    case "draft":
      return [{ to: "published", label: "Publish" }];
    case "published":
      return [
        { to: "hidden", label: "Hide from sign-up" },
        { to: "retired", label: "Retire" },
      ];
    case "hidden":
      return [
        { to: "published", label: "Show at sign-up" },
        { to: "retired", label: "Retire" },
      ];
    case "retired":
      return [];
  }
}

/** Households on a plan (any version, or one version), not counting cancelled ones. */
export function householdsOn(state: CatalogState, planId: string, version?: number): number {
  return state.subscriptions.filter(
    (s) =>
      s.planId === planId &&
      s.status !== "cancelled" &&
      (version === undefined || s.planVersion === version),
  ).length;
}

export function featureOffForEveryone(state: CatalogState, key: FeatureKey): boolean {
  const sw = FEATURES.find((f) => f.key === key)?.switchKey;
  return !!sw && state.switches.some((s) => s.key === sw && !s.enabled);
}

export type CatalogAction =
  | { type: "create_plan"; id: string; name: string }
  | { type: "save_plan"; planId: string; content: PlanContent }
  | { type: "set_status"; planId: string; status: PlanStatus }
  | { type: "delete_plan"; planId: string }
  | { type: "move_plan"; planId: string; direction: -1 | 1 }
  | { type: "save_addon"; addon: Addon }
  | { type: "set_switch"; key: SwitchKey; enabled: boolean; note: string };

export type ActionResult = { ok: true; state: CatalogState } | { ok: false; message: string };

const fail = (message: string): ActionResult => ({ ok: false, message });

function blankContent(name: string): PlanContent {
  return {
    name,
    description: "",
    prices: { monthly: null, annual: null, one_time: null },
    trialDays: 0,
    features: Object.fromEntries(FEATURES.map((f) => [f.key, false])) as Record<
      FeatureKey,
      boolean
    >,
    limits: { households: 1, kasambahay: 1, co_managers: 0 },
  };
}

function withPlan(state: CatalogState, plan: Plan): CatalogState {
  return { ...state, plans: state.plans.map((p) => (p.id === plan.id ? plan : p)) };
}

const firstError = (errors: ContentErrors) => Object.values(errors)[0];

/**
 * Every change the preview can make to the sample catalog, checked first. A
 * refused change returns the reason and leaves the state as it was.
 */
export function applyAction(
  state: CatalogState,
  action: CatalogAction,
  ctx: { now: Date; by: string } = { now: new Date(), by: "You" },
): ActionResult {
  const at = ctx.now.toISOString();
  const find = (id: string) => state.plans.find((p) => p.id === id);

  switch (action.type) {
    case "create_plan": {
      if (find(action.id)) return fail("A plan with this id already exists.");
      const content = blankContent(action.name.trim());
      const err = firstError(validateContent(content, state.plans));
      if (err) return fail(err);
      const order = Math.max(0, ...state.plans.map((p) => p.displayOrder)) + 1;
      const plan: Plan = {
        id: action.id,
        status: "draft",
        displayOrder: order,
        content,
        versions: [],
      };
      return { ok: true, state: { ...state, plans: [...state.plans, plan] } };
    }

    case "save_plan": {
      const plan = find(action.planId);
      if (!plan) return fail("This plan isn't in the catalog any more.");
      if (plan.status === "retired") return fail("A retired plan can't be changed.");
      const others = state.plans.filter((p) => p.id !== plan.id);
      const live = plan.status === "published" || plan.status === "hidden";
      const err = firstError(validateContent(action.content, others, { forPublish: live }));
      if (err) return fail(err);
      if (sameContent(plan.content, action.content)) return fail("Nothing has changed.");
      const content = { ...action.content, name: action.content.name.trim() };
      // A price someone saved is a real one, not the sample's placeholder.
      const pricePlaceholder =
        plan.pricePlaceholder && CYCLES.every((c) => plan.content.prices[c] === content.prices[c]);
      if (!isVersioned(plan)) {
        return { ok: true, state: withPlan(state, { ...plan, content, pricePlaceholder }) };
      }
      const version = {
        version: currentVersion(plan) + 1,
        savedAt: at,
        savedBy: ctx.by,
        summary: describeChanges(plan.content, content),
      };
      // Current subscribers stay on the version they joined; only new ones get this.
      return {
        ok: true,
        state: withPlan(state, {
          ...plan,
          content,
          pricePlaceholder,
          versions: [version, ...plan.versions],
        }),
      };
    }

    case "set_status": {
      const plan = find(action.planId);
      if (!plan) return fail("This plan isn't in the catalog any more.");
      if (!statusMoves(plan).some((m) => m.to === action.status)) {
        return fail(
          `A ${STATUS_LABEL[plan.status].toLowerCase()} plan can't become ${STATUS_LABEL[action.status].toLowerCase()}.`,
        );
      }
      if (action.status === "published") {
        const others = state.plans.filter((p) => p.id !== plan.id);
        const err = firstError(validateContent(plan.content, others, { forPublish: true }));
        if (err) return fail(err);
      }
      if (plan.status === "published" && action.status !== "published") {
        const stillPublished = state.plans.filter(
          (p) => p.id !== plan.id && p.status === "published",
        );
        if (stillPublished.length === 0) {
          return fail("Keep at least one plan published, so new households can sign up.");
        }
      }
      let next: Plan = { ...plan, status: action.status };
      if (action.status === "published" && !isVersioned(plan)) {
        next = {
          ...next,
          versions: [{ version: 1, savedAt: at, savedBy: ctx.by, summary: "First published" }],
        };
      }
      return { ok: true, state: withPlan(state, next) };
    }

    case "delete_plan": {
      const plan = find(action.planId);
      if (!plan) return fail("This plan isn't in the catalog any more.");
      if (plan.status !== "draft" || isVersioned(plan) || householdsOn(state, plan.id) > 0) {
        return fail("Only a draft that was never published can be deleted. Retire it instead.");
      }
      return { ok: true, state: { ...state, plans: state.plans.filter((p) => p.id !== plan.id) } };
    }

    case "move_plan": {
      const sorted = [...state.plans].sort((a, b) => a.displayOrder - b.displayOrder);
      const i = sorted.findIndex((p) => p.id === action.planId);
      const j = i + action.direction;
      if (i < 0) return fail("This plan isn't in the catalog any more.");
      if (j < 0 || j >= sorted.length) return fail("It's already at the end of the list.");
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      const order = new Map(sorted.map((p, k) => [p.id, k + 1]));
      return {
        ok: true,
        state: {
          ...state,
          plans: state.plans.map((p) => ({ ...p, displayOrder: order.get(p.id) as number })),
        },
      };
    }

    case "save_addon": {
      const a = action.addon;
      const name = a.name.trim();
      if (!name) return fail("Give the add-on a name.");
      if ([...name].length > MAX_NAME) return fail(`Keep the name to ${MAX_NAME} characters.`);
      if (!Number.isInteger(a.step) || a.step < 1 || a.step > 10) {
        return fail("Each add-on adds 1 to 10.");
      }
      if (
        a.monthlyPrice !== null &&
        (!Number.isSafeInteger(a.monthlyPrice) ||
          a.monthlyPrice < 0 ||
          a.monthlyPrice > MAX_CENTAVOS)
      ) {
        return fail("Enter a price from ₱0 to ₱999,999.99.");
      }
      if (a.status === "active" && a.monthlyPrice === null) {
        return fail("Set a price before offering it.");
      }
      const exists = state.addons.some((x) => x.id === a.id);
      const addon = { ...a, name };
      return {
        ok: true,
        state: {
          ...state,
          addons: exists
            ? state.addons.map((x) => (x.id === a.id ? addon : x))
            : [...state.addons, addon],
        },
      };
    }

    case "set_switch": {
      const sw = state.switches.find((s) => s.key === action.key);
      if (!sw) return fail("This switch doesn't exist.");
      if (sw.enabled === action.enabled) {
        return fail(`It's already ${action.enabled ? "on" : "off"}.`);
      }
      const note = action.note.trim();
      if (!note) return fail("Say why, for the record.");
      if ([...note].length > 200) return fail("Keep the reason to 200 characters.");
      return {
        ok: true,
        state: {
          ...state,
          switches: state.switches.map((s) =>
            s.key === sw.key
              ? { ...s, enabled: action.enabled, updatedAt: at, updatedBy: ctx.by }
              : s,
          ),
          switchHistory: [
            {
              id: `sw-${state.switchHistory.length + 1}`,
              key: sw.key,
              enabled: action.enabled,
              at,
              by: ctx.by,
              note,
            },
            ...state.switchHistory,
          ],
        },
      };
    }
  }
}
