/** What the Users screens show (FR-US-2, FR-US-3). No pay: see revealPayFn. */

export const USER_KINDS = ["primary_manager", "co_manager", "remote_admin", "helper"] as const;
export type UserKind = (typeof USER_KINDS)[number];

export type HelperStatus = "ACTIVE" | "PENDING_CLAIM" | "INACTIVE";
export type Employment = "live-in" | "live-out";

export type UserRow = {
  userId: string;
  fullName: string;
  email: string;
  kind: UserKind;
  householdId: string | null;
  householdName: string | null;
  householdCount: number;
  joinedAt: string;
  lastSignInAt: string | null;
  suspended: boolean;
  devices: number;
};

export type UserJob = {
  helperId: string;
  householdId: string;
  householdName: string;
  station: string | null;
  employment: Employment | null;
  status: HelperStatus;
  startedOn: string | null;
  endedOn: string | null;
  alsoWorksIn: { householdId: string; householdName: string }[];
};

export type UserDetail = Omit<UserRow, "householdId" | "householdName" | "householdCount"> & {
  memberships: { householdId: string; householdName: string; role: UserKind }[];
  jobs: UserJob[];
  deletion: { id: string; requestedAt: string } | null;
};
