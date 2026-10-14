import { HiddenValue } from "@/components/shared/hidden-value";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { HELPER_STATUS_TONE, STAGE_TONE, TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { HELPER_STATUS_LABEL, TICKET_STATUS_LABEL, USER_KIND_LABEL } from "@/data/labels";
import {
  contactForUser,
  deletionDaysLeft,
  householdsOf,
  listDeletionRequests,
  ticketsFor,
  userById,
} from "@/data/queries";
import { formatDate, formatPeso, formatRelativeDay } from "@/lib/format";

import { stageLabel } from "@/features/crm/crm.utils";

import { SuspendDialog } from "../components/suspend-dialog";

export function UserPage({ userId }: { userId: string }) {
  const user = userById(userId);
  if (!user) {
    return (
      <>
        <PageHeader title="User not found" back={<BackLink to="/users">Users</BackLink>} />
        <Surface>
          <EmptyState title="There's no user with this address">
            The account may have been deleted.
          </EmptyState>
        </Surface>
      </>
    );
  }

  const households = householdsOf(user);
  const contact = contactForUser(user.id);
  const deletion = listDeletionRequests().find(
    (d) => d.userId === user.id && d.status === "pending",
  );
  const tickets = ticketsFor({ userId: user.id });
  const suspended = user.status === "suspended";
  // A helper's jobs, across every household they work in (FR-US-3, FR-US-6).
  const jobs = households.flatMap((h) =>
    h.helpers.filter((x) => x.userId === user.id).map((job) => ({ household: h, job })),
  );

  return (
    <>
      <PageHeader
        back={<BackLink to="/users">Users</BackLink>}
        title={user.fullName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {suspended ? <StatusChip tone="danger">Suspended</StatusChip> : null}
            <span>{USER_KIND_LABEL[user.kind]}</span>
          </span>
        }
        actions={
          <SuspendDialog
            name={user.fullName}
            suspended={suspended}
            trigger={
              <Button variant={suspended ? "default" : "outline"}>
                {suspended ? "Unsuspend" : "Suspend"}
              </Button>
            }
          />
        }
      />

      {deletion ? (
        <div
          role="status"
          className="mb-6 rounded-3xl bg-terracotta-soft px-5 py-4 text-sm text-hearth-ink sm:px-6"
        >
          Asked to delete their account {formatRelativeDay(deletion.requestedAt)}.{" "}
          {deletionDaysLeft(deletion.requestedAt) >= 0
            ? `${deletionDaysLeft(deletion.requestedAt)} days left to process it.`
            : `${-deletionDaysLeft(deletion.requestedAt)} days past the deadline.`}{" "}
          <RecordLink to="/deletions" className="text-hearth-ink underline">
            Open deletion requests
          </RecordLink>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          {user.kind === "helper" ? (
            <Surface
              title="Jobs"
              description="Every household this helper works or worked in."
              flush
            >
              <ul className="divide-y divide-border pb-2">
                {jobs.map(({ household, job }) => (
                  <li key={job.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:px-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <RecordLink to={`/households/${household.id}`}>{household.name}</RecordLink>
                        <StatusChip tone={HELPER_STATUS_TONE[job.status]}>
                          {HELPER_STATUS_LABEL[job.status]}
                        </StatusChip>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.station}, {job.employment}, since {formatDate(job.startedOn)}
                        {job.endedOn ? `, ended ${formatDate(job.endedOn)}` : ""}
                      </p>
                    </div>
                    <div className="text-sm sm:text-right">
                      <span className="mr-2 text-xs text-muted-foreground">Monthly wage</span>
                      <HiddenValue
                        value={formatPeso(job.monthlyRate)}
                        what={`${user.fullName}'s wage`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Surface>
          ) : (
            <Surface title="Households" flush>
              <ul className="divide-y divide-border pb-2">
                {households.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6"
                  >
                    <RecordLink to={`/households/${h.id}`}>{h.name}</RecordLink>
                    <span className="text-xs text-muted-foreground">
                      {
                        USER_KIND_LABEL[
                          h.managers.find((m) => m.userId === user.id)?.role ?? "co_manager"
                        ]
                      }
                    </span>
                  </li>
                ))}
              </ul>
            </Surface>
          )}

          <Surface title="Support tickets" flush>
            {tickets.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No tickets.</p>
            ) : (
              <ul className="divide-y divide-border pb-2">
                {tickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
                  >
                    <RecordLink to={`/support/${t.id}`} className="min-w-0 truncate">
                      LIN-{t.ref} {t.subject}
                    </RecordLink>
                    <StatusChip tone={TICKET_STATUS_TONE[t.status]}>
                      {TICKET_STATUS_LABEL[t.status]}
                    </StatusChip>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <AuditTrail targetId={user.id} />
        </div>

        <div className="space-y-6">
          <Surface title="Profile">
            <DetailList
              items={[
                { label: "Email", value: user.email },
                { label: "Phone", value: user.phone, hidden: !user.phone },
                { label: "Joined", value: formatDate(user.joinedAt) },
                {
                  label: "Last sign-in",
                  value: user.lastSignInAt ? formatRelativeDay(user.lastSignInAt) : "Never",
                },
                { label: "Signed-in devices", value: user.devices },
              ]}
            />
          </Surface>
          {contact ? (
            <Surface title="CRM">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <RecordLink to={`/crm/${contact.id}`}>Open contact</RecordLink>
                <StatusChip tone={STAGE_TONE[contact.stage]}>{stageLabel(contact)}</StatusChip>
              </div>
            </Surface>
          ) : null}
          <p className="px-1 text-xs text-muted-foreground">
            Profiles and passwords are changed by the user in their own app, not here.
          </p>
        </div>
      </div>
    </>
  );
}
