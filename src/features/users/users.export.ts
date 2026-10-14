import type { AppUser } from "@/data/types";
import { csvDate, type CsvColumn } from "@/lib/csv";

/** For analysis: no name, email or phone (FR-EX-1). */
export const USER_CSV: CsvColumn<AppUser>[] = [
  { header: "user_id", value: (u) => u.id },
  { header: "role", value: (u) => u.kind },
  { header: "status", value: (u) => u.status },
  { header: "households", value: (u) => u.householdIds.length },
  { header: "devices", value: (u) => u.devices },
  { header: "joined", value: (u) => csvDate(u.joinedAt) },
  { header: "last_sign_in", value: (u) => csvDate(u.lastSignInAt) },
];
