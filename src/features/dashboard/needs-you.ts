import { CURRENT_STAFF_ID } from "@/data/sample";
import {
  DELETION_DAYS,
  deletionDaysLeft,
  listContacts,
  listDeletionRequests,
  listPayouts,
  listStaff,
  listTickets,
  staffById,
  userById,
} from "@/data/queries";
import { PAYOUT_STATUS_LABEL } from "@/data/labels";
import { daysBetween } from "@/lib/format";

/**
 * The dashboard's lead: dated work waiting on the business team, soonest
 * deadline first. Each item says what to do and opens the screen to do it.
 */
export type NeedsYouItem = {
  id: string;
  /** The deadline, or when it happened for things that are already late. */
  at: string;
  group: "late" | "today" | "week";
  /** For problems with no deadline: a word to show instead of a time. */
  tag?: string;
  title: string;
  detail: string;
  href: string;
};

const LOOKAHEAD_DAYS = 7;
const DAY = 86_400_000;

function groupFor(at: string, now: Date): NeedsYouItem["group"] | null {
  const d = daysBetween(now, at);
  if (d < 0) return "late";
  if (d === 0) return "today";
  return d <= LOOKAHEAD_DAYS ? "week" : null;
}

export function needsYou(now: Date = new Date()): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const r of listDeletionRequests()) {
    if (r.status !== "pending") continue;
    const left = deletionDaysLeft(r.requestedAt, now);
    if (left > LOOKAHEAD_DAYS) continue;
    const due = new Date(Date.parse(r.requestedAt) + DELETION_DAYS * DAY).toISOString();
    const who = userById(r.userId)?.fullName ?? "a deleted account";
    items.push({
      id: r.id,
      at: due,
      group: groupFor(due, now) ?? "week",
      title: `Process ${who}'s deletion request`,
      detail:
        r.blockers.length > 0
          ? `${r.blockers.length === 1 ? "1 blocker" : `${r.blockers.length} blockers`} to clear first`
          : "Nothing blocking it",
      href: "/deletions",
    });
  }

  for (const p of listPayouts()) {
    items.push({
      id: p.id,
      at: p.createdAt,
      group: "today",
      tag: PAYOUT_STATUS_LABEL[p.status],
      title: `Check ${p.helperName}'s payout`,
      detail: p.reason,
      href: "/payouts",
    });
  }

  for (const c of listContacts(now)) {
    for (const f of c.followUps) {
      if (f.doneAt) continue;
      const group = groupFor(f.dueAt, now);
      if (!group) continue;
      const who = f.assigneeId === CURRENT_STAFF_ID ? "you" : staffById(f.assigneeId)?.fullName;
      items.push({
        id: f.id,
        at: f.dueAt,
        group,
        title: f.note,
        detail: `${c.fullName}, assigned to ${who}`,
        href: `/crm/${c.id}`,
      });
    }
  }

  for (const t of listTickets()) {
    if (t.status !== "open" || t.assigneeId) continue;
    items.push({
      id: t.id,
      at: t.createdAt,
      group: "today",
      tag: "Unassigned",
      title: `Assign LIN-${t.ref}`,
      detail: t.subject,
      href: `/support/${t.id}`,
    });
  }

  for (const s of listStaff()) {
    if (s.twoStepSetUp) continue;
    items.push({
      id: s.id,
      at: s.addedAt,
      group: "today",
      tag: "Not set up",
      title: `${s.fullName} hasn't set up two-step sign-in`,
      detail: "They can't open the console until they do",
      href: "/team",
    });
  }

  const order = { late: 0, today: 1, week: 2 };
  return items.sort((a, b) => order[a.group] - order[b.group] || a.at.localeCompare(b.at));
}
