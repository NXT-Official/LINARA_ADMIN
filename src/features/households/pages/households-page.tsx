import { useMemo, useState } from "react";

import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { ListToolbar, SearchField } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { STAGE_TONE } from "@/components/shared/tones";
import { CUSTOMER_STAGE_LABEL } from "@/data/labels";
import { activeHelpers, listHouseholds, primaryManagerOf } from "@/data/queries";
import type { Household } from "@/data/types";
import { householdStage } from "@/features/crm/crm-stage";
import { ExportCsvButton } from "@/components/shared/export-button";

import { formatDate, formatRelativeDay } from "@/lib/format";
import { householdCsv } from "../households.export";

export function HouseholdsPage() {
  const now = useMemo(() => new Date(), []);
  const all = listHouseholds();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (h) =>
      !needle ||
      h.name.toLowerCase().includes(needle) ||
      primaryManagerOf(h)?.fullName.toLowerCase().includes(needle),
  );

  const columns: Column<Household>[] = [
    {
      key: "name",
      header: "Household",
      mobile: "primary",
      cell: (h) => (
        <div className="min-w-0">
          <RowLink to={`/households/${h.id}`}>{h.name}</RowLink>
          <div className="truncate text-xs text-muted-foreground">
            {primaryManagerOf(h)?.fullName ?? "No primary manager"}
          </div>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      mobile: "primary",
      cell: (h) => {
        const s = householdStage(h, now);
        return <StatusChip tone={STAGE_TONE[s]}>{CUSTOMER_STAGE_LABEL[s]}</StatusChip>;
      },
    },
    { key: "managers", header: "Managers", align: "right", cell: (h) => h.managers.length },
    {
      key: "helpers",
      header: "Helpers working",
      align: "right",
      cell: (h) => activeHelpers(h).length,
    },
    {
      key: "activity",
      header: "Last task",
      cell: (h) => (h.lastActivityAt ? formatRelativeDay(h.lastActivityAt, now) : "None yet"),
    },
    { key: "created", header: "Created", mobile: "hidden", cell: (h) => formatDate(h.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Households"
        description="Every home on Linara. Read-only: households are run from the household app."
        actions={<ExportCsvButton slug="households" columns={householdCsv(now)} rows={rows} />}
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SearchField value={q} onChange={setQ} label="Search household or manager" />
          </ListToolbar>
          <DataTable
            label="Households"
            rows={rows}
            columns={columns}
            rowKey={(h) => h.id}
            empty={
              <EmptyState title="No households match">Clear the search to see them all.</EmptyState>
            }
            footer={<ListFooter shown={rows.length} total={rows.length} />}
          />
        </div>
      </Surface>
    </>
  );
}
