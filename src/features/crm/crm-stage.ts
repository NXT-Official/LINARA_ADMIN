import { daysBetween } from "@/lib/format";
import type { CustomerStage, Household } from "@/data/types";

/**
 * Customer stages are worked out from app data each time they are shown
 * (spec §5.2.2), never stored. The two limits are one setting so they can be
 * tuned after launch without a schema change (D16).
 */
export const STAGE_DAYS = { active: 7, atRisk: 30 } as const;

/** One household's stage. */
export function householdStage(
  household: Pick<Household, "helpers" | "lastActivityAt">,
  now: Date = new Date(),
): CustomerStage {
  const setUp = household.helpers.some((h) => h.status === "ACTIVE" || h.status === "INACTIVE");
  if (household.lastActivityAt) {
    const idle = daysBetween(household.lastActivityAt, now);
    if (idle <= STAGE_DAYS.active) return "active";
    if (!setUp) return "signed_up";
    return idle <= STAGE_DAYS.atRisk ? "at_risk" : "inactive";
  }
  return household.helpers.some((h) => h.status === "ACTIVE") ? "set_up" : "signed_up";
}

const RANK: Record<CustomerStage, number> = {
  active: 5,
  set_up: 4,
  at_risk: 3,
  signed_up: 2,
  inactive: 1,
};

/** A customer's stage is the best across the households they manage. */
export function customerStage(
  households: Pick<Household, "helpers" | "lastActivityAt">[],
  now: Date = new Date(),
): CustomerStage {
  if (households.length === 0) return "signed_up";
  return households
    .map((h) => householdStage(h, now))
    .reduce((best, s) => (RANK[s] > RANK[best] ? s : best));
}
