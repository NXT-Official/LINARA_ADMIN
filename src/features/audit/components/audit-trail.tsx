import { Surface } from "@/components/shared/page";
import { auditFor, staffById } from "@/data/queries";
import { formatDateTime } from "@/lib/format";

import { actionLabel } from "../audit.utils";

/** Console actions on one record, for its detail page. */
export function AuditTrail({ targetId }: { targetId: string }) {
  const entries = auditFor(targetId);
  return (
    <Surface title="History in the console" flush>
      {entries.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
          No admin has changed anything here.
        </p>
      ) : (
        <ol className="divide-y divide-border pb-2">
          {entries.map((e) => (
            <li key={e.id} className="px-5 py-3 sm:px-6">
              <p className="text-sm text-foreground">
                <span className="font-semibold">
                  {staffById(e.actorId)?.fullName ?? "An admin"}
                </span>{" "}
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
