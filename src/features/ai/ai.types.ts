/** AI calls over the 48 hours Linara keeps them (§5.8, D38). Cost isn't recorded. */

export type AiUsage = {
  hourly: { fn: string; hour: string; calls: number }[];
  topUsers: { userId: string; name: string | null; calls: number }[];
  limitHits: {
    userId: string;
    name: string | null;
    kind: "hourly" | "daily";
    fn: string | null;
    at: string;
  }[];
  calls24h: number;
};

/** Limits from LINARA/supabase/add-ai-call-limits.sql. */
export const AI_HOURLY_LIMIT = 60;
export const AI_DAILY_LIMIT = 300;
