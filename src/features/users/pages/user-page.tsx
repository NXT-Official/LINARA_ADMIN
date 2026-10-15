import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { HiddenValue } from "@/components/shared/hidden-value";
import { BackLink, RecordLink } from "@/components/shared/links";
import { DetailList, PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { HELPER_STATUS_TONE } from "@/components/shared/tones";
import { HELPER_STATUS_LABEL, USER_KIND_LABEL } from "@/data/labels";
import { AuditTrail } from "@/features/audit/components/audit-trail";
import { payRevealer } from "@/features/pay/pay-reveal";
import { daysBetween, formatDate, formatRelativeDay } from "@/lib/format";

import { getUserFn } from "../users.actions";
import type { UserDetail, UserJob } from "../users.types";

/** Linara processes a deletion within 30 days of the request (§5.5). */
const DELETION_DAYS = 30;

export function UserPage({ userId }: { userId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["user", userId],
    queryFn: () => getUserFn({ data: { userId } }),
  });

  if (isPending) {
    return <PageHeader title="Loading user" back={<BackLink to="/users">Users</BackLink>} />;
  }
  if (!data?.ok) {
    const missing = data?.code === "not_found";
    return (
      <>
        <PageHeader
          title={missing ? "User not found" : "The user didn't load"}
          back={<BackLink to="/users">Users</BackLink>}
        />
        <Surface>
          <EmptyState title={missing ? "There's no user with this address" : "Try again"}>
            {missing ? "The account may have been deleted." : data?.message}
          </EmptyState>
        </Surface>
      </>
    );
  }
  return <UserDetailView user={data.user} />;
}

function UserDetailView({ user }: { user: UserDetail }) {
  const deletion = user.deletion;
  const daysLeft = deletion ? DELETION_DAYS - daysBetween(deletion.requestedAt, new Date()) : 0;

  return (
    <>
      <PageHeader
        back={<BackLink to="/users">Users</BackLink>}
        title={user.fullName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {user.suspended ? <StatusChip tone="danger">Suspended</StatusChip> : null}
            <span>{USER_KIND_LABEL[user.kind]}</span>
          </span>
        }
      />

      {deletion ? (
        <div
          role="status"
          className="mb-6 rounded-3xl bg-terracotta-soft px-5 py-4 text-sm text-hearth-ink sm:px-6"
        >
          Asked to delete their account {formatRelativeDay(deletion.requestedAt)}.{" "}
          {daysLeft >= 0
            ? `${daysLeft} days left to process it.`
            : `${-daysLeft} days past the deadline.`}
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
              {user.jobs.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">No jobs yet.</p>
              ) : (
                <ul className="divide-y divide-border pb-2">
                  {user.jobs.map((job) => (
                    <JobItem key={job.helperId} job={job} name={user.fullName} />
                  ))}
                </ul>
              )}
            </Surface>
          ) : (
            <Surface title="Households" flush>
              {user.memberships.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
                  Not in a household.
                </p>
              ) : (
                <ul className="divide-y divide-border pb-2">
                  {user.memberships.map((m) => (
                    <li
                      key={m.householdId}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6"
                    >
                      <RecordLink to={`/households/${m.householdId}`}>{m.householdName}</RecordLink>
                      <span className="text-xs text-muted-foreground">
                        {USER_KIND_LABEL[m.role]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Surface>
          )}

          <Surface title="Support tickets">
            <p className="text-sm text-muted-foreground">Arrives with Support (Phase 5).</p>
          </Surface>

          <AuditTrail targetId={user.userId} />
        </div>

        <div className="space-y-6">
          <Surface title="Profile">
            <DetailList
              items={[
                { label: "Email", value: user.email },
                { label: "Joined", value: formatDate(user.joinedAt) },
                {
                  label: "Last sign-in",
                  value: user.lastSignInAt ? formatRelativeDay(user.lastSignInAt) : "Never",
                },
                { label: "Devices with notifications", value: user.devices },
              ]}
            />
          </Surface>
          <Surface title="CRM">
            <p className="text-sm text-muted-foreground">Arrives with the CRM (Phase 3).</p>
          </Surface>
          <p className="px-1 text-xs text-muted-foreground">
            Profiles and passwords are changed by the user in their own app, not here.
          </p>
        </div>
      </div>
    </>
  );
}

function JobItem({ job, name }: { job: UserJob; name: string }) {
  const pay = useMemo(() => payRevealer(job.helperId), [job.helperId]);
  const facts = [
    job.station,
    job.employment,
    job.startedOn ? `since ${formatDate(job.startedOn)}` : null,
    job.endedOn ? `ended ${formatDate(job.endedOn)}` : null,
  ].filter(Boolean);

  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <RecordLink to={`/households/${job.householdId}`}>{job.householdName}</RecordLink>
          <StatusChip tone={HELPER_STATUS_TONE[job.status]}>
            {HELPER_STATUS_LABEL[job.status]}
          </StatusChip>
        </div>
        {facts.length ? (
          <p className="mt-1 text-xs text-muted-foreground">{facts.join(", ")}</p>
        ) : null}
        {job.alsoWorksIn.length ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Also works in{" "}
            {job.alsoWorksIn.map((h, i) => (
              <span key={h.householdId}>
                {i > 0 ? ", " : null}
                <RecordLink to={`/households/${h.householdId}`}>{h.householdName}</RecordLink>
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <dl className="grid gap-1.5 text-sm sm:text-right">
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <dt className="text-xs text-muted-foreground">Monthly wage</dt>
          <dd>
            <HiddenValue what={`${name}'s monthly wage`} reveal={pay.wage} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <dt className="text-xs text-muted-foreground">Payout account</dt>
          <dd>
            <HiddenValue what={`${name}'s payout account`} reveal={pay.account} />
          </dd>
        </div>
      </dl>
    </li>
  );
}
