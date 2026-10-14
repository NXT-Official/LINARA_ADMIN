import type { Payout } from "@/data/types";
import { csvDate, type CsvColumn } from "@/lib/csv";

/** For analysis: no helper name and no amount, which is pay data (FR-EX-1, S-17). */
export const PAYOUT_CSV: CsvColumn<Payout>[] = [
  { header: "payout_id", value: (p) => p.id },
  { header: "status", value: (p) => p.status },
  { header: "household_id", value: (p) => p.householdId },
  { header: "xendit_reference", value: (p) => p.reference },
  { header: "sent", value: (p) => csvDate(p.createdAt) },
];
