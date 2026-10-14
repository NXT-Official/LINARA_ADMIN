import { useState } from "react";

import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { ListToolbar, SearchField } from "@/components/shared/list-toolbar";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { listAudit, staffById } from "@/data/queries";
import type { AuditEntry } from "@/data/types";
import { ExportCsvButton } from "@/components/shared/export-button";

import { formatDateTime } from "@/lib/format";
import { AUDIT_CSV } from "../audit.export";

import { actionLabel, targetHref } from "../audit.utils";

const TARGET_LABEL: Record<AuditEntry["targetType"], string> = {
  user: "User",
  household: "Household",
  ticket: "Ticket",
  contact: "Contact",
  staff: "Admin",
  payout: "Payout",
  export: "Export",
};

export function AuditPage() {
  const all = listAudit();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (e) =>
      !needle ||
      [staffById(e.actorId)?.fullName, actionLabel(e.action), e.reason, TARGET_LABEL[e.targetType]]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle)),
  );

  const columns: Column<AuditEntry>[] = [
    {
      key: "what",
      header: "Action",
      mobile: "primary",
      cell: (e) => <span className="font-semibold text-foreground">{actionLabel(e.action)}</span>,
    },
    {
      key: "who",
      header: "By",
      mobile: "primary",
      cell: (e) => staffById(e.actorId)?.fullName ?? "An admin",
    },
    {
      key: "target",
      header: "About",
      cell: (e) => {
        const href = targetHref(e);
        const label = TARGET_LABEL[e.targetType];
        return href ? <RecordLink to={href}>{label}</RecordLink> : label;
      },
    },
    {
      key: "reason",
      header: "Reason",
      className: "max-w-72",
      cell: (e) =>
        e.reason ? (
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
        actions={<ExportCsvButton slug="audit-log" columns={AUDIT_CSV} rows={rows} />}
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SearchField value={q} onChange={setQ} label="Search person, action or reason" />
          </ListToolbar>
          <DataTable
            label="Audit log"
            rows={rows}
            columns={columns}
            rowKey={(e) => e.id}
            empty={
              <EmptyState title="No entries match">Clear the search to see everything.</EmptyState>
            }
            footer={<ListFooter shown={rows.length} total={rows.length} />}
          />
        </div>
      </Surface>
    </>
  );
}
