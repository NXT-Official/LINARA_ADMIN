import { useQuery } from "@tanstack/react-query";

import { TEAM_KEYS } from "./team-keys";

import { listTeamNamesFn } from "./team.actions";

/** The actor id the nightly CRM retention records itself as (D35). */
export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/**
 * The team's members, for owner and assignee pickers and for naming who did
 * something. Members are shown by email: the console stores no names.
 */
export function useAdmins() {
  const { data } = useQuery({ queryKey: TEAM_KEYS.names, queryFn: () => listTeamNamesFn() });
  const admins = data?.ok ? data.members : [];
  const me = admins.find((a) => a.isYou)?.userId ?? null;
  return {
    admins,
    me,
    options: admins.map((a) => ({
      value: a.userId,
      label: a.isYou ? `${a.email} (you)` : a.email,
    })),
    /** "You", the member's email, "Automatic job", or "Former member" for someone since removed. */
    name: (id: string | null | undefined) => {
      if (!id) return null;
      if (id === SYSTEM_ACTOR) return "Automatic job";
      const a = admins.find((x) => x.userId === id);
      return a ? (a.isYou ? "You" : a.email) : "Former member";
    },
  };
}
