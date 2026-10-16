import type { CsvColumn } from "@/lib/csv";

import type { AiUsage } from "./ai.types";

/** For analysis: ids and counts, never a name (FR-EX-1). */
export const AI_HOURLY_CSV: CsvColumn<AiUsage["hourly"][number]>[] = [
  { header: "feature", value: (r) => r.fn },
  { header: "hour_start", value: (r) => new Date(r.hour).toISOString() },
  { header: "calls", value: (r) => r.calls },
];

export const AI_TOP_USERS_CSV: CsvColumn<AiUsage["topUsers"][number]>[] = [
  { header: "user_id", value: (r) => r.userId },
  { header: "calls_24h", value: (r) => r.calls },
];

export const AI_LIMIT_HITS_CSV: CsvColumn<AiUsage["limitHits"][number]>[] = [
  { header: "user_id", value: (r) => r.userId },
  { header: "limit", value: (r) => r.kind },
  { header: "feature", value: (r) => r.fn },
  { header: "at", value: (r) => new Date(r.at).toISOString() },
];
