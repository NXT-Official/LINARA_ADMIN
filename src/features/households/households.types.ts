import type { Employment, HelperStatus, UserKind } from "@/features/users/users.types";

/** What the Households screens show (FR-HH-1, FR-HH-2). No pay: see revealPayFn. */

export type HouseholdRow = {
  householdId: string;
  name: string;
  createdAt: string;
  primaryManagerId: string | null;
  primaryManagerName: string | null;
  managers: number;
  helpersActive: number;
  lastActivityAt: string | null;
  tasksScheduled7d: number;
  tasksDone7d: number;
};

export type HouseholdHelper = {
  helperId: string;
  userId: string | null;
  name: string;
  station: string | null;
  employment: Employment | null;
  status: HelperStatus;
  startedOn: string | null;
  endedOn: string | null;
  /** Works here from another household's staff (helper_households). */
  shared: boolean;
};

export type HouseholdDetail = {
  householdId: string;
  name: string;
  createdAt: string;
  timezone: string | null;
  managers: { userId: string; fullName: string; role: UserKind }[];
  helpers: HouseholdHelper[];
  tasksScheduled7d: number;
  tasksDone7d: number;
  tasksDone30d: number;
  lastActivityAt: string | null;
};
