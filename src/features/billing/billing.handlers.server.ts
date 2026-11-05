import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import { applyAction, type CatalogAction } from "@/features/plans/plans.logic";
import { SAMPLE_CATALOG } from "@/features/plans/plans.sample";
import type { CatalogState, GlobalSwitch, Plan, SwitchKey } from "@/features/plans/plans.types";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import type { BillingAction } from "./billing.logic";
import type { LiveBilling, Payment, PaymentChannel, Subscription } from "./billing.types";

/**
 * Plans, subscriptions and switches on real data (D48, 018-billing.sql). One
 * read returns everything the three screens show; each change is checked with
 * the same rules the screen uses (plans.logic.ts) against what the database
 * holds now, then written by one SQL function with its audit entry.
 */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("billing", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

type DbState = {
  plans: Plan[];
  addons: CatalogState["addons"];
  switches: { key: string; enabled: boolean; updatedAt: string; updatedBy: string }[];
  switchHistory: CatalogState["switchHistory"];
  subscriptions: (Omit<Subscription, "method" | "status"> & {
    status: string;
    method: string | null;
  })[];
  payments: {
    id: string;
    subscriptionId: string;
    reference: string;
    amount: number;
    status: "pending" | "paid" | "failed" | "expired" | "review" | "cancelled";
    channel: string | null;
    createdAt: string;
    failureReason: string | null;
  }[];
  testTools: boolean;
};

/** Xendit's channel names, as the screen labels them. */
function channel(raw: string | null): PaymentChannel | null {
  if (!raw) return null;
  const c = raw.toUpperCase();
  if (c === "GCASH") return "GCASH";
  if (c === "PAYMAYA" || c === "MAYA") return "MAYA";
  if (c.includes("CARD")) return "CARD";
  if (c === "QRPH") return "QRPH";
  return "OTHER";
}

const SWITCH_INFO = new Map(SAMPLE_CATALOG.switches.map((s) => [s.key, s]));

export function toState(db: DbState): LiveBilling {
  const switches: GlobalSwitch[] = db.switches.flatMap((s) => {
    const info = SWITCH_INFO.get(s.key as SwitchKey);
    // Only switches the console knows how to describe; test tools are shown elsewhere.
    if (!info) return [];
    return [
      {
        ...info,
        enabled: s.enabled,
        updatedAt: s.updatedAt,
        updatedBy: s.updatedBy ? "Console" : "SQL editor",
      },
    ];
  });
  const subscriptions: Subscription[] = db.subscriptions.map((s) => ({
    ...s,
    // Past the 7-day grace the database calls it restricted; the screen shows it as past due.
    status: s.status === "restricted" ? "past_due" : (s.status as Subscription["status"]),
    method: s.method ? { channel: channel(s.method) ?? "OTHER", ending: "" } : null,
  }));
  const payments: Payment[] = db.payments.map((p) => ({
    id: p.id,
    subscriptionId: p.subscriptionId,
    reference: p.reference,
    amount: p.amount,
    // Expired and replaced pages were never paid; a page paid after it was
    // replaced is "review" and needs a refund in Xendit.
    status:
      p.status === "expired" || p.status === "cancelled"
        ? "failed"
        : p.status === "review"
          ? "pending"
          : p.status,
    method: { channel: channel(p.channel) ?? "OTHER", ending: "" },
    createdAt: p.createdAt,
    failureReason:
      p.status === "review"
        ? (p.failureReason ?? "Paid, but needs checking.")
        : p.status === "pending"
          ? "Waiting on Xendit."
          : p.failureReason,
  }));
  return {
    state: {
      plans: db.plans.map((p) => ({
        ...p,
        versions: p.versions.map((v) => ({ ...v, savedBy: v.savedBy ? "Console" : "Setup" })),
      })),
      addons: db.addons,
      switches,
      switchHistory: db.switchHistory.map((h) => ({ ...h, by: "Console" })),
      subscriptions,
      payments,
    },
    testTools: db.testTools,
  };
}

async function loadState(): Promise<LiveBilling> {
  return toState(await call<DbState>("staff_billing_state"));
}

/** Everything the Plans, Subscriptions and Global switches screens show. */
export function loadBillingHandler(): Promise<LiveBilling | PublicError> {
  return run(async () => {
    await requireStaff("billing.view");
    return loadState();
  });
}

const bad = (message: string) => new ConsoleError("invalid_input", message);

/**
 * A change to the catalog or a switch. Checked with the screen's own rules
 * against the current data, then written. Turning a switch on needs a fresh
 * two-step code (plan R16).
 */
export function catalogActionHandler(input: {
  action: CatalogAction;
  code?: string;
}): Promise<LiveBilling | PublicError> {
  return run(async () => {
    const action = input?.action;
    if (!action || typeof action !== "object") throw bad("Unknown change.");
    const staff = await requireStaff(
      action.type === "set_switch" ? "switches.manage" : "billing.manage",
    );
    if (action.type === "set_switch" && action.enabled) {
      if (typeof input.code !== "string") throw bad("Enter your two-step code.");
      await requireFreshCode(staff, input.code);
    }
    const before = await loadState();
    const res = applyAction(before.state, action, { now: new Date(), by: staff.userId });
    if (!res.ok) throw new ConsoleError("conflict", res.message);
    const actor = staff.userId;
    switch (action.type) {
      case "create_plan": {
        const plan = res.state.plans.find((p) => p.id === action.id);
        await call("staff_billing_create_plan", {
          p_actor: actor,
          p_id: action.id,
          p_content: plan?.content,
        });
        break;
      }
      case "save_plan": {
        const plan = res.state.plans.find((p) => p.id === action.planId);
        await call("staff_billing_save_plan", {
          p_actor: actor,
          p_id: action.planId,
          p_content: plan?.content,
          p_summary: plan?.versions[0]?.summary ?? "",
          p_placeholder: plan?.pricePlaceholder ?? false,
        });
        break;
      }
      case "set_status":
        await call("staff_billing_set_status", {
          p_actor: actor,
          p_id: action.planId,
          p_status: action.status,
        });
        break;
      case "delete_plan":
        await call("staff_billing_delete_plan", { p_actor: actor, p_id: action.planId });
        break;
      case "move_plan":
        await call("staff_billing_set_order", {
          p_actor: actor,
          p_ids: [...res.state.plans]
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((p) => p.id),
        });
        break;
      case "save_addon":
        await call("staff_billing_save_addon", { p_actor: actor, p_addon: action.addon });
        break;
      case "set_switch":
        await call("staff_set_switch", {
          p_actor: actor,
          p_key: action.key,
          p_enabled: action.enabled,
          p_note: action.note,
        });
        break;
      default:
        throw bad("Unknown change.");
    }
    return loadState();
  });
}

/**
 * A change to a subscription. Payments settle through Xendit's callback, so
 * retrying or refunding one is done in Xendit's dashboard for now.
 */
export function billingActionHandler(action: BillingAction): Promise<LiveBilling | PublicError> {
  return run(async () => {
    const staff = await requireStaff("billing.manage");
    if (!action || typeof action !== "object") throw bad("Unknown change.");
    const actor = staff.userId;
    switch (action.type) {
      case "cancel_at_period_end":
      case "resume":
        if (!isUuid(action.subscriptionId)) throw bad("Unknown subscription.");
        await call("staff_billing_set_cancel", {
          p_actor: actor,
          p_manager: action.subscriptionId,
          p_cancel: action.type === "cancel_at_period_end",
        });
        break;
      case "change_plan":
        if (!isUuid(action.subscriptionId)) throw bad("Unknown subscription.");
        await call("staff_billing_set_plan", {
          p_actor: actor,
          p_manager: action.subscriptionId,
          p_plan: action.planId,
          p_cycle: action.cycle,
          p_addons: action.addons,
        });
        break;
      case "retry_payment":
      case "refund_payment":
        throw new ConsoleError(
          "conflict",
          "Payments go through Xendit: retry or refund this one in Xendit's dashboard.",
        );
      default:
        throw bad("Unknown change.");
    }
    return loadState();
  });
}

/** Test tools only: moves a subscription's renewal date by whole days. */
export function testShiftHandler(input: {
  subscriptionId: string;
  days: number;
}): Promise<LiveBilling | PublicError> {
  return run(async () => {
    const staff = await requireStaff("billing.manage");
    if (!isUuid(input?.subscriptionId)) throw bad("Unknown subscription.");
    if (!Number.isInteger(input.days)) throw bad("Move it by whole days.");
    await call("staff_billing_test_shift", {
      p_actor: staff.userId,
      p_manager: input.subscriptionId,
      p_days: input.days,
    });
    return loadState();
  });
}
