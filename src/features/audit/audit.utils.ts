import { AUDIT_ACTION_LABEL } from "@/data/labels";
import type { AuditEntry } from "@/data/types";

export function actionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/** Where an entry's target lives in the console, if it has a page (FR-AU-2). */
export function targetHref(e: Pick<AuditEntry, "targetType" | "targetId">): string | null {
  switch (e.targetType) {
    case "user":
      return `/users/${e.targetId}`;
    case "household":
      return `/households/${e.targetId}`;
    case "ticket":
      return `/support/${e.targetId}`;
    case "contact":
      return `/crm/${e.targetId}`;
    case "staff":
      return "/team";
    default:
      return null;
  }
}
