import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  billingReducer,
  type BillingAction,
  type BillingResult,
} from "@/features/billing/billing.logic";
import type { LiveBilling } from "@/features/billing/billing.types";
import type { PublicError } from "@/lib/console-error";
import { setSampleToasts } from "@/lib/sample-toast";

import { setSampleNote } from "./components/sample-bar";

import { applyAction, type ActionResult, type CatalogAction } from "./plans.logic";
import { SAMPLE_CATALOG } from "./plans.sample";
import type { CatalogState } from "./plans.types";

/**
 * The catalog and subscriptions shared by the Subscriptions, Plans, plan and
 * Global switches screens, so a change on one shows on the others.
 *
 * Live (D48, 018-billing.sql applied): loaded from the database. A change is
 * checked here with the same rules first and shows at once, then the server
 * checks it again against the database and saves it; if the server refuses,
 * the screen goes back to what the database holds and says why.
 *
 * Sample (before 018 is applied, or in tests): the D47 sample, in this tab's
 * memory only, back to the sample on reload. Nothing is written anywhere.
 */
let state: CatalogState = SAMPLE_CATALOG;
let live = false;
let testTools = false;
let loading = false;
// Until the first read answers, the screens show their shape, not the sample.
let ready = false;
let requested = false;
const listeners = new Set<() => void>();
let snapshot = { state, live, testTools, loading, ready };

function emit() {
  snapshot = { state, live, testTools, loading, ready };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const actions = () => import("@/features/billing/billing.actions");

const isError = (r: LiveBilling | PublicError): r is PublicError => "ok" in r && r.ok === false;

function applyLive(res: LiveBilling) {
  state = res.state;
  live = true;
  testTools = res.testTools;
  setSampleNote(false);
  setSampleToasts(false);
}

/**
 * Loads the real catalog. Stays on the sample when billing isn't set up in
 * this database yet (the read fails), so the screens still work.
 */
export async function loadLiveBilling(): Promise<boolean> {
  loading = true;
  emit();
  try {
    const res = await (await actions()).loadBillingFn();
    if (isError(res)) return false;
    applyLive(res);
    return true;
  } catch {
    return false;
  } finally {
    loading = false;
    ready = true;
    emit();
  }
}

/** Sends a change and shows what the database holds after it, or why it was refused. */
async function persist(send: () => Promise<LiveBilling | PublicError>, before: CatalogState) {
  try {
    const res = await send();
    if (isError(res)) {
      state = before;
      emit();
      toast.error(res.message);
      void loadLiveBilling();
      return;
    }
    applyLive(res);
    emit();
  } catch {
    state = before;
    emit();
    toast.error("That wasn't saved. Check your connection and try again.");
  }
}

export function dispatchCatalog(action: CatalogAction, opts: { code?: string } = {}): ActionResult {
  const before = state;
  const res = applyAction(state, action);
  if (res.ok) {
    state = res.state;
    emit();
    if (live) {
      void persist(
        async () => (await actions()).catalogActionFn({ data: { action, code: opts.code } }),
        before,
      );
    }
  }
  return res;
}

/**
 * A change that waits for the database before it shows: turning a switch on
 * (the server checks the two-step code), so a wrong code never looks saved.
 */
export async function dispatchCatalogAndWait(
  action: CatalogAction,
  opts: { code?: string } = {},
): Promise<ActionResult> {
  if (!live) return dispatchCatalog(action, opts);
  const check = applyAction(state, action);
  if (!check.ok) return check;
  try {
    const res = await (await actions()).catalogActionFn({ data: { action, code: opts.code } });
    if (isError(res)) return { ok: false, message: res.message };
    applyLive(res);
    emit();
    return { ok: true, state };
  } catch {
    return { ok: false, message: "That wasn't saved. Check your connection and try again." };
  }
}

/** A subscription or payment change on the Subscriptions screen (D40). */
export function dispatchBilling(action: BillingAction): BillingResult {
  if (live && (action.type === "retry_payment" || action.type === "refund_payment")) {
    return {
      ok: false,
      message: "Payments go through Xendit: retry or refund this one in Xendit's dashboard.",
    };
  }
  const before = state;
  const res = billingReducer(state, action);
  if (res.ok) {
    state = res.state;
    emit();
    if (live) void persist(async () => (await actions()).billingActionFn({ data: action }), before);
  }
  return res;
}

/** Test tools only (dev and staging): moves a subscription's renewal date by whole days. */
export async function shiftRenewal(subscriptionId: string, days: number): Promise<void> {
  if (!live || !testTools) return;
  await persist(
    async () => (await actions()).testShiftFn({ data: { subscriptionId, days } }),
    state,
  );
}

/** Sample: back to the sample. Live: reads the database again. */
export function resetCatalog() {
  if (live) {
    void loadLiveBilling();
    return;
  }
  state = SAMPLE_CATALOG;
  ready = true;
  emit();
}

export function useCatalog(): CatalogState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/**
 * Whether the screens show real data, the test tools, and whether the first
 * read has answered yet (ready). The first screen to ask starts that read.
 */
export function useBillingMode(): {
  live: boolean;
  testTools: boolean;
  loading: boolean;
  ready: boolean;
} {
  const s = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  useEffect(() => {
    if (requested || ready) return;
    requested = true;
    void loadLiveBilling();
  }, []);
  return { live: s.live, testTools: s.testTools, loading: s.loading, ready: s.ready };
}
