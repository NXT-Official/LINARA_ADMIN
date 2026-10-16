import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { DataTable, ListPager, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { FormDialog } from "@/components/shared/form";
import { RecordLink } from "@/components/shared/links";
import { ListToolbar, SegmentedFilter } from "@/components/shared/list-toolbar";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { USER_KIND_LABEL } from "@/data/labels";
import { CodeField } from "@/features/auth/components/code-field";
import { useCan } from "@/features/auth/use-can";
import type { UserKind } from "@/features/users/users.types";
import { formatDate, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import { listDeletionsFn, processDeletionFn } from "../deletions.actions";
import { DELETION_CSV } from "../deletions.export";
import type {
  DeletionBlocker,
  DeletionResult,
  DeletionRow,
  DeletionView,
} from "../deletions.types";
import { describeDeletion } from "../deletions.utils";

const DUE_DAYS = 30;
const DUE_SOON_DAYS = 7;

/** What blocks a deletion, in words, with what the household has to do (FR-DL-2). */
const BLOCKER_TEXT: Record<DeletionBlocker, string> = {
  console_admin: "This account is on the console team. Manage it on the Team screen.",
  active_employment: "Still employed: the household has to end the job, with final pay, first.",
  last_manager_with_helpers:
    "Last manager of a household that still has a helper working: the household has to end each job, with final pay, first.",
};

// A console team member has a login but no Linara profile, so no name either.
const name = (r: DeletionRow) =>
  r.fullName ??
  (r.blockers.includes("console_admin") ? "Console team member" : "Account already gone");
const kind = (r: DeletionRow) =>
  r.userType && r.userType in USER_KIND_LABEL ? USER_KIND_LABEL[r.userType as UserKind] : "Unknown";

/** FR-DL-3, FR-DL-4: what goes and what stays, then the code; LINARA's refusal as it is. */
function ProcessDialog({
  request,
  onDone,
}: {
  request: DeletionRow;
  onDone: (result: DeletionResult) => void;
}) {
  const [code, setCode] = useState("");
  return (
    <FormDialog
      trigger={
        <Button
          size="sm"
          variant="outline"
          className="relative z-10"
          aria-label={`Process ${name(request)}'s request`}
        >
          Process
        </Button>
      }
      title={`Delete ${name(request)}'s account`}
      submitLabel="Delete account"
      done="Account deleted"
      destructive
      canSubmit={code.length === 6}
      onOpenChange={(open) => !open && setCode("")}
      onSubmit={async () => {
        const res = await processDeletionFn({ data: { requestId: request.requestId, code } });
        setCode("");
        if (res.ok) onDone(res.result);
        return res;
      }}
    >
      {(id) => (
        <>
          {/* What process_account_deletion does (LINARA, add-household-managers.sql),
              plus the console's own forgetting (FR-DL-5, FR-DL-6, D36). */}
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-semibold text-foreground">Deleted</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>Their sign-in, profile and devices</li>
                {request.userType === "helper" ? (
                  <li>Their private notes</li>
                ) : (
                  <li>
                    If they are the last manager: the household's appointments, pantry, groceries,
                    routines and unclaimed invites
                  </li>
                )}
                <li>Name, email, phone and notes on their CRM contact</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Kept</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>
                  Each job with its payslips, hours and leave, which the household must keep by law
                </li>
                <li>Tasks a helper did</li>
                <li>Dates and stages on the CRM contact, without the person</li>
                <li>An audit entry with ids only</li>
              </ul>
            </div>
          </div>
          <CodeField id={id("code")} value={code} onChange={setCode} />
        </>
      )}
    </FormDialog>
  );
}

export function DeletionsPage() {
  const queryClient = useQueryClient();
  const canProcess = useCan()("deletions.process");
  const [view, setView] = useState<DeletionView>("pending");
  // What the last processing did, from LINARA's own report (FR-DL-4).
  const [outcome, setOutcome] = useState<string | null>(null);
  const [paging, setPaging] = useState({ view: "pending" as DeletionView, page: 0 });
  const page = paging.view === view ? paging.page : 0;

  const input = { view, page };
  const { data, isPending, isFetching } = useQuery({
    queryKey: ["deletions", input],
    queryFn: () => listDeletionsFn({ data: input }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.ok ? data.requests : [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["deletions"] });

  const who: Column<DeletionRow> = {
    key: "who",
    header: "Account",
    mobile: "primary",
    cell: (r) =>
      r.fullName ? (
        <RecordLink to={`/users/${r.userId}`}>{r.fullName}</RecordLink>
      ) : (
        <span className="text-muted-foreground">{name(r)}</span>
      ),
  };

  const pendingColumns: Column<DeletionRow>[] = [
    who,
    {
      key: "left",
      header: "Time left",
      mobile: "primary",
      cell: (r) =>
        r.daysLeft < 0 ? (
          <StatusChip tone="late">{plural(-r.daysLeft, "day")} overdue</StatusChip>
        ) : (
          <span className={cn(r.daysLeft <= DUE_SOON_DAYS && "font-semibold text-terracotta-ink")}>
            {r.daysLeft === 1 ? "1 day" : `${r.daysLeft} days`}
          </span>
        ),
    },
    { key: "kind", header: "Kind", cell: kind },
    { key: "asked", header: "Requested", cell: (r) => formatDate(r.requestedAt) },
    {
      key: "act",
      header: "",
      align: "right",
      mobile: "primary",
      className: "max-w-80",
      cell: (r) =>
        r.blockers.length ? (
          <span className="text-left text-xs text-status-late-ink">
            {r.blockers.map((b) => BLOCKER_TEXT[b]).join(" ")}
          </span>
        ) : !canProcess ? (
          <span className="text-xs text-muted-foreground">Ready to process</span>
        ) : (
          <ProcessDialog
            request={r}
            onDone={(result) => {
              setOutcome(describeDeletion(r.fullName, result));
              void refresh();
            }}
          />
        ),
    },
  ];

  const historyColumns: Column<DeletionRow>[] = [
    { ...who, cell: (r) => <span className="text-muted-foreground">{name(r)}</span> },
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
    { key: "kind", header: "Kind", cell: kind },
    { key: "asked", header: "Requested", cell: (r) => formatDate(r.requestedAt) },
    {
      key: "done",
      header: "Finished",
      cell: (r) => (r.processedAt ? formatDate(r.processedAt) : ""),
    },
  ];

  return (
    <>
      <PageHeader
        title="Deletion requests"
        description={`Users ask to delete their account in the app. Each request has to be processed within ${DUE_DAYS} days.`}
        actions={<ExportCsvButton slug="deletion-requests" columns={DELETION_CSV} rows={rows} />}
      />
      {outcome ? (
        <p
          role="status"
          className="mb-6 rounded-3xl bg-sand-deep px-5 py-4 text-sm text-foreground sm:px-6"
        >
          {outcome}
        </p>
      ) : null}
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: "pending", label: "Waiting" },
                { value: "history", label: "History" },
              ]}
            />
          </ListToolbar>
          <div className={isFetching && !isPending ? "opacity-60" : undefined}>
            {data && !data.ok ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="The requests didn't load">{data.message}</EmptyState>
              </div>
            ) : (
              <DataTable
                label={
                  view === "pending" ? "Waiting deletion requests" : "Finished deletion requests"
                }
                rows={rows}
                columns={view === "pending" ? pendingColumns : historyColumns}
                rowKey={(r) => r.requestId}
                empty={
                  <EmptyState
                    title={
                      isPending
                        ? "Loading requests"
                        : view === "pending"
                          ? "No requests waiting"
                          : "No finished requests yet"
                    }
                  />
                }
                footer={
                  <ListPager
                    page={page}
                    hasMore={!!(data?.ok && data.hasMore)}
                    busy={isFetching}
                    onPage={(p) => setPaging({ view, page: p })}
                  />
                }
              />
            )}
          </div>
        </div>
      </Surface>
    </>
  );
}
