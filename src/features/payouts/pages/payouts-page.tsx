import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { HiddenValue } from "@/components/shared/hidden-value";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { PAYOUT_STATUS_TONE } from "@/components/shared/tones";
import { PAYOUT_STATUS_LABEL } from "@/data/labels";
import { householdById, listPayouts } from "@/data/queries";
import type { Payout } from "@/data/types";
import { ExportCsvButton } from "@/components/shared/export-button";

import { formatDateTime, formatPeso } from "@/lib/format";
import { PAYOUT_CSV } from "../payouts.export";

export function PayoutsPage() {
  const rows = listPayouts();
  const columns: Column<Payout>[] = [
    {
      key: "helper",
      header: "Helper",
      mobile: "primary",
      cell: (p) => <span className="font-semibold text-foreground">{p.helperName}</span>,
    },
    {
      key: "status",
      header: "Problem",
      mobile: "primary",
      cell: (p) => (
        <StatusChip tone={PAYOUT_STATUS_TONE[p.status]}>{PAYOUT_STATUS_LABEL[p.status]}</StatusChip>
      ),
    },
    { key: "reason", header: "What Linara knows", className: "max-w-80", cell: (p) => p.reason },
    {
      key: "household",
      header: "Household",
      cell: (p) => {
        const h = householdById(p.householdId);
        return h ? <RecordLink to={`/households/${h.id}`}>{h.name}</RecordLink> : "Unknown";
      },
    },
    {
      key: "amount",
      header: "Amount",
      cell: (p) => (
        <HiddenValue value={formatPeso(p.amount)} what={`${p.helperName}'s payout amount`} />
      ),
    },
    {
      key: "ref",
      header: "Xendit reference",
      mobile: "hidden",
      cell: (p) => <span className="tabular-nums">{p.reference}</span>,
    },
    {
      key: "at",
      header: "Sent",
      cell: (p) => <span className="whitespace-nowrap">{formatDateTime(p.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Wage payouts that failed, came back unclear, or have been sending for over an hour. This screen only reads Linara's records and can't change a payout."
        actions={<ExportCsvButton slug="payout-problems" columns={PAYOUT_CSV} rows={rows} />}
      />
      <Surface flush>
        <div className="pt-2">
          <DataTable
            label="Payouts with a problem"
            rows={rows}
            columns={columns}
            rowKey={(p) => p.id}
            empty={
              <EmptyState title="No payout problems">Every recent payout went through.</EmptyState>
            }
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ListFooter shown={rows.length} total={rows.length} />
                <p className="text-xs text-muted-foreground">
                  To see the latest status, search the reference in the Xendit dashboard.
                </p>
              </div>
            }
          />
        </div>
      </Surface>
    </>
  );
}
