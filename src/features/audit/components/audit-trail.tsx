import { useQuery } from "@tanstack/react-query";

import { Surface } from "@/components/shared/page";
import { useCan } from "@/features/auth/use-can";
import { listTeamNamesFn } from "@/features/team/team.actions";
import { TEAM_KEYS } from "@/features/team/team-keys";
import { formatDateTime } from "@/lib/format";

import { listAuditFn } from "../audit.actions";
import { actionLabel } from "../audit.utils";

/** Console actions on one record, newest first, for its detail page. */
export function AuditTrail({ targetId }: { targetId: string }) {
  const canView = useCan()("audit.view");
  const { data, isPending } = useQuery({
    queryKey: ["audit", { page: 0, targetId }],
    queryFn: () => listAuditFn({ data: { page: 0, targetId } }),
    enabled: canView,
  });
  const { data: adminData } = useQuery({
    queryKey: TEAM_KEYS.names,
    queryFn: () => listTeamNamesFn(),
    enabled: canView,
  });
  const admins = adminData?.ok ? adminData.members : [];
  const who = (id: string) => admins.find((a) => a.userId === id)?.email ?? "Former member";
  const entries = data?.ok ? data.entries : [];
  // A role without the audit log doesn't see the history at all (FR-RL-8).
  if (!canView) return null;

  return (
    <Surface title="History in the console" flush>
      {isPending ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading history.</p>
      ) : data && !data.ok ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">{data.message}</p>
      ) : entries.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
          No one on the team has done anything here.
        </p>
      ) : (
        <ol className="divide-y divide-border pb-2">
          {entries.map((e) => (
            <li key={e.id} className="px-5 py-3 sm:px-6">
              <p className="text-sm text-foreground">
                <span className="font-semibold">{who(e.actorId)}</span>{" "}
                {actionLabel(e.action).toLowerCase()}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(e.at)}
                {e.reason ? `. Reason: ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Surface>
  );
}
