import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DataTable, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { RefreshButton } from "@/components/shared/refresh-button";
import { SelectField } from "@/components/shared/form";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState, TableSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDIT_ACTION_LABEL } from "@/data/labels";
import { listTeamNamesFn } from "@/features/team/team.actions";
import { TEAM_KEYS } from "@/features/team/team-keys";
import { formatDateTime } from "@/lib/format";

import { listAuditFn } from "../audit.actions";
import { AUDIT_CSV } from "../audit.export";
import type { AuditRow } from "../audit.handlers.server";
import { actionLabel, targetHref } from "../audit.utils";

const ANY = "any";

const TARGET_LABEL: Record<string, string> = {
  user: "User",
  household: "Household",
  ticket: "Ticket",
  contact: "Contact",
  staff: "Team member",
  role: "Role",
  payout: "Payout",
  export: "Export",
  import: "Import",
  helper: "Helper",
  auth: "Sign-in",
};

function FilterLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <Label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
      {children}
    </Label>
  );
}

export function AuditPage() {
  const [actorId, setActorId] = useState(ANY);
  const [action, setAction] = useState(ANY);
  const [targetType, setTargetType] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const filters = {
    page,
    actorId: actorId === ANY ? undefined : actorId,
    action: action === ANY ? undefined : action,
    targetType: targetType === ANY ? undefined : targetType,
    from: from || undefined,
    to: to || undefined,
  };
  const { data, isPending, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["audit", filters],
    queryFn: () => listAuditFn({ data: filters }),
    // Refetching keeps the current rows on screen, dimmed, instead of flashing empty.
    placeholderData: (prev) => prev,
  });
  const { data: adminData } = useQuery({
    queryKey: TEAM_KEYS.names,
    queryFn: () => listTeamNamesFn(),
  });
  const admins = adminData?.ok ? adminData.members : [];
  const who = (id: string) => admins.find((a) => a.userId === id)?.email ?? "Former member";

  const entries = data?.ok ? data.entries : [];
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  const columns: Column<AuditRow>[] = [
    {
      key: "what",
      header: "Action",
      mobile: "primary",
      cell: (e) => <span className="font-semibold text-foreground">{actionLabel(e.action)}</span>,
    },
    { key: "who", header: "By", mobile: "primary", cell: (e) => who(e.actorId) },
    {
      key: "target",
      header: "About",
      cell: (e) => {
        const label = TARGET_LABEL[e.targetType ?? ""] ?? e.targetType ?? "";
        const href = targetHref(e);
        return href ? <RecordLink to={href}>{label}</RecordLink> : label;
      },
    },
    {
      key: "reason",
      header: "Reason",
      className: "max-w-72",
      cell: (e) =>
        e.reason ? (
          // Free text typed by an admin: rendered as text, never as HTML (S-15).
          <span className="line-clamp-2">{e.reason}</span>
        ) : (
          <span className="text-muted-foreground">None given</span>
        ),
    },
    {
      key: "at",
      header: "When",
      cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, reveal and export made in the console. Entries can't be edited or deleted."
        actions={
          <>
            <RefreshButton queryKeys={[["audit"]]} updatedAt={dataUpdatedAt} />
            <ExportCsvButton slug="audit-log" columns={AUDIT_CSV} rows={entries} />
          </>
        }
      />
      <Surface flush>
        {/* Filters in one row, scoping everything below (FR-AU-1). */}
        <div className="grid gap-3 px-5 pt-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
          <div className="space-y-1.5">
            <FilterLabel htmlFor="f-who">Person</FilterLabel>
            <SelectField
              id="f-who"
              value={actorId}
              onChange={reset(setActorId)}
              options={[
                { value: ANY, label: "Anyone" },
                ...admins.map((a) => ({ value: a.userId, label: a.email })),
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <FilterLabel htmlFor="f-action">Action</FilterLabel>
            <SelectField
              id="f-action"
              value={action}
              onChange={reset(setAction)}
              options={[
                { value: ANY, label: "Any action" },
                ...Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <FilterLabel htmlFor="f-target">About</FilterLabel>
            <SelectField
              id="f-target"
              value={targetType}
              onChange={reset(setTargetType)}
              options={[
                { value: ANY, label: "Anything" },
                ...Object.entries(TARGET_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <FilterLabel htmlFor="f-from">From</FilterLabel>
            <Input
              id="f-from"
              type="date"
              value={from}
              onChange={(e) => reset(setFrom)(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <FilterLabel htmlFor="f-to">To</FilterLabel>
            <Input
              id="f-to"
              type="date"
              value={to}
              onChange={(e) => reset(setTo)(e.target.value)}
            />
          </div>
        </div>

        <div className={isFetching && !isPending ? "pt-3 opacity-60" : "pt-3"}>
          {data && !data.ok ? (
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState title="The audit log didn't load">{data.message}</EmptyState>
            </div>
          ) : (
            <DataTable
              label="Audit log"
              rows={entries}
              columns={columns}
              rowKey={(e) => e.id}
              empty={
                isPending ? (
                  <TableSkeleton label="Loading entries" />
                ) : (
                  <EmptyState title="No entries match">Change or clear the filters.</EmptyState>
                )
              }
              footer={
                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0 || isFetching}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Newer
                  </Button>
                  <span className="text-xs text-muted-foreground">Page {page + 1}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!(data?.ok && data.hasMore) || isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Older
                  </Button>
                </div>
              }
            />
          )}
        </div>
      </Surface>
    </>
  );
}
