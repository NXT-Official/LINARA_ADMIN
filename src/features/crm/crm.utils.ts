import { CUSTOMER_STAGE_LABEL, LEAD_STAGE_LABEL } from "@/data/labels";
import type { ContactRow } from "@/data/queries";
import type { CustomerStage, LeadStage } from "@/data/types";
import { daysBetween } from "@/lib/format";

export function stageLabel(c: Pick<ContactRow, "kind" | "stage">): string {
  return c.kind === "lead"
    ? LEAD_STAGE_LABEL[c.stage as LeadStage]
    : CUSTOMER_STAGE_LABEL[c.stage as CustomerStage];
}

/** A follow-up due today or already late. */
export function hasDueFollowUp(c: Pick<ContactRow, "nextFollowUp">, now: Date): boolean {
  return !!c.nextFollowUp && daysBetween(now, c.nextFollowUp.dueAt) <= 0;
}
