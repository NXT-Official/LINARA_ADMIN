import { useQuery } from "@tanstack/react-query";

import { Surface } from "@/components/shared/page";
import { listAdminsFn } from "@/features/team/team.actions";
import { formatDateTime } from "@/lib/format";

import { listAuditFn } from "../audit.actions";
import { actionLabel } from "../audit.utils";

/** Console actions on one record, newest first, for its detail page. */
export function AuditTrail({ targetId }: { targetId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["audit", { page: 0, targetId }],
    queryFn: () => listAuditFn({ data: { page: 0, targetId } }),
  });
  const { data: adminData } = useQuery({ queryKey: ["admins"], queryFn: () => listAdminsFn() });
  const admins = adminData?.ok ? adminData.admins : [];
  const who = (id: string) => admins.find((a) => a.userId === id)?.email ?? "Former admin";
  const entries = data?.ok ? data.entries : [];

  return (
    <Surface title="History in the console" flush>
      {isPending ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading history.</p>
      ) : data && !data.ok ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">{data.message}</p>
      ) : entries.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
          No admin has done anything here.
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
