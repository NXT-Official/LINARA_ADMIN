import { useQuery } from "@tanstack/react-query";

import { listAdminsFn } from "./team.actions";

/** The actor id the nightly CRM retention records itself as (D35). */
export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/**
 * The console's admins, for owner and assignee pickers and for naming who did
 * something. Admins are shown by email: the console stores no admin names.
 */
export function useAdmins() {
  const { data } = useQuery({ queryKey: ["admins"], queryFn: () => listAdminsFn() });
  const admins = data?.ok ? data.admins : [];
  const me = admins.find((a) => a.isYou)?.userId ?? null;
  return {
    admins,
    me,
    options: admins.map((a) => ({
      value: a.userId,
      label: a.isYou ? `${a.email} (you)` : a.email,
    })),
    /** "You", the admin's email, "Automatic job", or "Former admin" for someone since removed. */
    name: (id: string | null | undefined) => {
      if (!id) return null;
      if (id === SYSTEM_ACTOR) return "Automatic job";
      const a = admins.find((x) => x.userId === id);
      return a ? (a.isYou ? "You" : a.email) : "Former admin";
    },
  };
}
