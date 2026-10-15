import { csvDate, type CsvColumn } from "@/lib/csv";

import type { UserRow } from "./users.types";

/** For analysis: no name, email or phone (FR-EX-1). */
export const USER_CSV: CsvColumn<UserRow>[] = [
  { header: "user_id", value: (u) => u.userId },
  { header: "role", value: (u) => u.kind },
  { header: "suspended", value: (u) => (u.suspended ? "yes" : "no") },
  { header: "households", value: (u) => u.householdCount },
  { header: "devices", value: (u) => u.devices },
  { header: "joined", value: (u) => csvDate(u.joinedAt) },
  { header: "last_sign_in", value: (u) => csvDate(u.lastSignInAt) },
];
