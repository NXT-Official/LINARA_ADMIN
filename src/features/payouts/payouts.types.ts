import type { PayoutKind } from "@/data/types";

/** Payout problems, read from Linara's own records (§5.7, D38). Never an amount (S-17). */

export type { PayoutKind };

export const PAYOUT_KINDS: readonly PayoutKind[] = [
  "failed",
  "cancelled",
  "unclear",
  "stuck",
  "no_answer",
];

export type PayoutProblem = {
  attemptId: string;
  payslipId: string;
  attemptNumber: number;
  kind: PayoutKind;
  failureReason: string | null;
  referenceId: string;
  channelCode: string;
  helperId: string;
  helperName: string | null;
  householdId: string | null;
  householdName: string | null;
  cutoffStart: string;
  cutoffEnd: string;
  createdAt: string;
};

export type PayoutCounts = Record<PayoutKind, number>;
