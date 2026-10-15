import { CUSTOMER_STAGE_LABEL, LEAD_STAGE_LABEL } from "@/data/labels";
import type { CustomerStage, LeadStage } from "@/data/types";
import { daysBetween } from "@/lib/format";

import { CUSTOMER_STAGES, LEAD_STAGES, type ContactRef } from "./crm.types";

export function stageLabel(c: { kind: "lead" | "customer"; stage: string }): string {
  return c.kind === "lead"
    ? LEAD_STAGE_LABEL[c.stage as LeadStage]
    : CUSTOMER_STAGE_LABEL[c.stage as CustomerStage];
}

/** A follow-up due today or already late, as a Manila day. */
export function isDue(dueAt: string | null, now: Date): boolean {
  return !!dueAt && daysBetween(now, dueAt) <= 0;
}

/** A saved contact's page, or a manager's page before anything is saved (§5.2.1). */
export function contactHref(c: { contactId: string | null; userId: string | null }): string {
  return c.contactId ? `/crm/${c.contactId}` : `/crm/account/${c.userId}`;
}

/** The same thing as a reference for the server. */
export function contactRef(c: { contactId: string | null; userId: string | null }): ContactRef {
  return c.contactId ? { contactId: c.contactId } : { userId: c.userId ?? "" };
}

/** The list's starting filters from a link's search params; anything unknown is dropped. */
export function contactFiltersFromSearch(search: Record<string, unknown>): {
  kind?: "lead" | "customer";
  stage?: string;
  due?: "today" | "overdue";
} {
  const stages: readonly unknown[] = [...LEAD_STAGES, ...CUSTOMER_STAGES];
  return {
    ...(search.kind === "lead" || search.kind === "customer" ? { kind: search.kind } : {}),
    ...(stages.includes(search.stage) ? { stage: search.stage as string } : {}),
    ...(search.due === "today" || search.due === "overdue" ? { due: search.due } : {}),
  };
}
