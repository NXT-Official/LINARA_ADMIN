/** The Phase 2 dashboard (FR-DB-1 to FR-DB-3, D32). */
export type DashboardNumbers = {
  households: number;
  householdsNew7d: number;
  householdsNew30d: number;
  householdsActive7d: number;
  managers: number;
  managersMultiHome: number;
  helpersActive: number;
  helpersInvited: number;
  helpersEnded: number;
};

export type DashboardData = DashboardNumbers & {
  /** 8 Manila weeks, Monday first, oldest first. */
  newHouseholdsWeekly: { weekStart: string; count: number }[];
  /** 14 Manila days, oldest first. */
  tasksDoneDaily: { day: string; count: number }[];
};
