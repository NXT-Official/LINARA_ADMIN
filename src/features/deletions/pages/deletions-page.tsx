import { useMemo, useState } from "react";

import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form";
import { ListToolbar, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { CodeField } from "@/features/auth/components/code-field";
import { DELETION_DAYS, deletionDaysLeft, listDeletionRequests, userById } from "@/data/queries";
import type { DeletionRequest } from "@/data/types";
import { ExportCsvButton } from "@/components/shared/export-button";

import { formatDate, plural } from "@/lib/format";
import { deletionCsv } from "../deletions.export";
import { cn } from "@/lib/utils";

const DUE_SOON_DAYS = 7;

function personName(r: DeletionRequest) {
  return userById(r.userId)?.fullName ?? "Deleted account";
}

/** FR-DL-2 to FR-DL-4: blockers first, then what goes and what stays, then the code. */
function ProcessDialog({ request }: { request: DeletionRequest }) {
  const [code, setCode] = useState("");
  const blocked = request.blockers.length > 0;
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline" className="relative z-10">
          Process
        </Button>
      }
      title={`Delete ${personName(request)}'s account`}
      submitLabel="Delete account"
      done="Account deleted"
      destructive
      canSubmit={!blocked && code.length === 6}
    >
      {(id) => (
        <>
          {blocked ? (
            <div className="rounded-2xl bg-status-late-soft p-4 text-sm text-status-late-ink">
              <p className="font-semibold">This can't be processed yet</p>
              <ul className="mt-1 list-disc pl-5">
                {request.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-2">
                The household has to end the job or hand the household to another manager first.
              </p>
            </div>
          ) : null}
          {/* What process_account_deletion does (LINARA/supabase/add-account-deletion.sql),
              plus the console's own anonymisation (FR-DL-5, FR-DL-6). */}
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-semibold text-foreground">Deleted</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>Their sign-in, profile and devices</li>
                {request.kind === "helper" ? (
                  <li>Their private notes</li>
                ) : (
                  <li>
                    If they are the last manager: the household's appointments, pantry, groceries,
                    routines and unclaimed invites
                  </li>
                )}
                <li>Name, email and phone on their CRM contact and tickets</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Kept</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>
                  Each job with its payslips, hours and leave, which the household must keep by law
                </li>
                <li>Tasks a helper did</li>
                <li>Dates and counts on the CRM contact and tickets, without the name</li>
                <li>An audit entry with ids only</li>
              </ul>
            </div>
          </div>
          {!blocked ? <CodeField id={id("code")} value={code} onChange={setCode} /> : null}
        </>
      )}
    </FormDialog>
  );
}

export function DeletionsPage() {
  const now = useMemo(() => new Date(), []);
  const all = listDeletionRequests();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const pending = all
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const history = all.filter((r) => r.status !== "pending");

  const pendingColumns: Column<DeletionRequest>[] = [
    {
      key: "who",
      header: "Account",
      mobile: "primary",
      cell: (r) =>
        userById(r.userId) ? (
          <RecordLink to={`/users/${r.userId}`}>{personName(r)}</RecordLink>
        ) : (
          personName(r)
        ),
    },
    {
      key: "left",
      header: "Time left",
      mobile: "primary",
      cell: (r) => {
        const left = deletionDaysLeft(r.requestedAt, now);
        if (left < 0) return <StatusChip tone="late">{plural(-left, "day")} overdue</StatusChip>;
        return (
          <span className={cn(left <= DUE_SOON_DAYS && "font-semibold text-terracotta-ink")}>
            {left === 1 ? "1 day" : `${left} days`}
          </span>
        );
      },
    },
    { key: "kind", header: "Kind", cell: (r) => (r.kind === "manager" ? "Manager" : "Helper") },
    { key: "asked", header: "Requested", cell: (r) => formatDate(r.requestedAt) },
    {
      key: "blockers",
      header: "Blockers",
      cell: (r) =>
        r.blockers.length ? (
          <span className="text-status-late-ink">{r.blockers.length}</span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      mobile: "primary",
      cell: (r) => <ProcessDialog request={r} />,
    },
  ];

  const historyColumns: Column<DeletionRequest>[] = [
    { key: "who", header: "Account", mobile: "primary", cell: (r) => personName(r) },
    {
      key: "status",
      header: "Outcome",
      mobile: "primary",
      cell: (r) =>
        r.status === "done" ? (
          <StatusChip tone="done">Deleted</StatusChip>
        ) : (
          <StatusChip tone="quiet">Withdrawn</StatusChip>
        ),
    },
    { key: "kind", header: "Kind", cell: (r) => (r.kind === "manager" ? "Manager" : "Helper") },
    { key: "asked", header: "Requested", cell: (r) => formatDate(r.requestedAt) },
    {
      key: "done",
      header: "Finished",
      cell: (r) => (r.finishedAt ? formatDate(r.finishedAt) : ""),
    },
  ];

  const rows = tab === "pending" ? pending : history;

  return (
    <>
      <PageHeader
        title="Deletion requests"
        description={`Users ask to delete their account in the app. Each request has to be processed within ${DELETION_DAYS} days.`}
        actions={<ExportCsvButton slug="deletion-requests" columns={deletionCsv(now)} rows={all} />}
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Show"
              value={tab}
              onChange={setTab}
              options={[
                { value: "pending", label: "Waiting", count: pending.length },
                { value: "history", label: "History", count: history.length },
              ]}
            />
          </ListToolbar>
          <DataTable
            label={tab === "pending" ? "Waiting deletion requests" : "Finished deletion requests"}
            rows={rows}
            columns={tab === "pending" ? pendingColumns : historyColumns}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title={tab === "pending" ? "No requests waiting" : "No finished requests yet"}
              />
            }
            footer={<ListFooter shown={rows.length} total={rows.length} />}
          />
        </div>
      </Surface>
    </>
  );
}
