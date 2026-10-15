import type { DeletionResult } from "./deletions.types";

const homes = (n: number) => (n === 1 ? "1 household" : `${n} households`);

/**
 * What processing did, from process_account_deletion's own report (FR-DL-4):
 * a household cleared because they were its last manager is deleted too,
 * unless it still holds employment records, which the law keeps.
 */
export function describeDeletion(name: string | null, r: DeletionResult): string {
  if (r.account_missing) return "The account was already gone. The request is closed.";
  const parts = [`Deleted ${name ? `${name}'s` : "the"} account.`];
  const deleted = r.households_deleted?.length ?? 0;
  const cleared = (r.households_cleared ?? []).filter(
    (h) => !(r.households_deleted ?? []).includes(h),
  ).length;
  if (deleted) {
    parts.push(
      `${homes(deleted)} they were the last manager of ${deleted === 1 ? "was" : "were"} deleted with it.`,
    );
  }
  if (cleared) {
    parts.push(
      `${homes(cleared)} they were the last manager of ${cleared === 1 ? "was" : "were"} cleared; ${cleared === 1 ? "it stays" : "they stay"} because ${cleared === 1 ? "its" : "their"} employment records do.`,
    );
  }
  const notes = r.private_notes_deleted ?? 0;
  if (notes) parts.push(`${notes} private ${notes === 1 ? "note was" : "notes were"} deleted.`);
  return parts.join(" ");
}
