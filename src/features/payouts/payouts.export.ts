import { csvDate, type CsvColumn } from "@/lib/csv";

import type { PayoutProblem } from "./payouts.types";

/** For analysis: no helper or household name, reason or amount (FR-EX-1, S-17). */
export const PAYOUT_CSV: CsvColumn<PayoutProblem>[] = [
  { header: "attempt_id", value: (p) => p.attemptId },
  { header: "payslip_id", value: (p) => p.payslipId },
  { header: "attempt", value: (p) => p.attemptNumber },
  { header: "problem", value: (p) => p.kind },
  { header: "channel", value: (p) => p.channelCode },
  { header: "helper_id", value: (p) => p.helperId },
  { header: "household_id", value: (p) => p.householdId },
  { header: "xendit_reference", value: (p) => p.referenceId },
  { header: "cutoff_start", value: (p) => p.cutoffStart },
  { header: "cutoff_end", value: (p) => p.cutoffEnd },
  { header: "sent", value: (p) => csvDate(p.createdAt) },
];
