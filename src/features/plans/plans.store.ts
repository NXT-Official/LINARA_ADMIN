import { useSyncExternalStore } from "react";

import { applyAction, type ActionResult, type CatalogAction } from "./plans.logic";
import { SAMPLE_CATALOG } from "./plans.sample";
import type { CatalogState } from "./plans.types";

/**
 * The sample catalog, shared by the Plans, plan and Global switches screens so
 * a change on one shows on the others. It lives in this tab's memory only and
 * goes back to the sample on reload (D41, D47): nothing is written anywhere.
 */
let state: CatalogState = SAMPLE_CATALOG;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dispatchCatalog(action: CatalogAction): ActionResult {
  const res = applyAction(state, action);
  if (res.ok) {
    state = res.state;
    emit();
  }
  return res;
}

export function resetCatalog() {
  state = SAMPLE_CATALOG;
  emit();
}

export function useCatalog(): CatalogState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
