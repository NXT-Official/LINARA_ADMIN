/** Account deletion requests (§5.5, FR-DL-1 to FR-DL-7). */

export type DeletionBlocker = "console_admin" | "active_employment" | "last_manager_with_helpers";
export type DeletionView = "pending" | "history";

export type DeletionRow = {
  requestId: string;
  userId: string;
  /** Null once the account is gone. */
  fullName: string | null;
  userType: string | null;
  status: "pending" | "done" | "cancelled";
  requestedAt: string;
  /** The request plus 30 days. */
  dueAt: string;
  /** Manila days to the due date; negative when overdue. */
  daysLeft: number;
  processedAt: string | null;
  blockers: DeletionBlocker[];
};

export type DeletionCounts = { pending: number; dueSoon: number; overdue: number };

/** What process_account_deletion reports back (LINARA, add-household-managers.sql). */
export type DeletionResult = {
  user_id?: string;
  user_type?: string | null;
  household_deleted?: boolean;
  households_deleted?: string[];
  /** Households they were the last manager of; deleted too unless records remain. */
  households_cleared?: string[];
  private_notes_deleted?: number;
  /** The account was already gone; the request was only closed. */
  account_missing?: boolean;
};
