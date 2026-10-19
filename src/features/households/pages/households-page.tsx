import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DataTable, ListPager, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { RefreshButton } from "@/components/shared/refresh-button";
import { ListToolbar, SearchField } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState, TableSkeleton } from "@/components/shared/states";
import { formatDate, formatRelativeDay } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { listHouseholdsFn } from "../households.actions";
import { HOUSEHOLD_CSV } from "../households.export";
import type { HouseholdRow } from "../households.types";

const columns: Column<HouseholdRow>[] = [
  {
    key: "name",
    header: "Household",
    mobile: "primary",
    cell: (h) => (
      <div className="min-w-0">
        <RowLink to={`/households/${h.householdId}`}>{h.name}</RowLink>
        <div className="truncate text-xs text-muted-foreground">
          {h.primaryManagerName ?? "No primary manager"}
        </div>
      </div>
    ),
  },
  {
    key: "activity",
    header: "Last activity",
    mobile: "primary",
    cell: (h) => (h.lastActivityAt ? formatRelativeDay(h.lastActivityAt) : "No tasks yet"),
  },
  { key: "managers", header: "Managers", align: "right", cell: (h) => h.managers },
  { key: "helpers", header: "Helpers working", align: "right", cell: (h) => h.helpersActive },
  { key: "created", header: "Created", mobile: "hidden", cell: (h) => formatDate(h.createdAt) },
];

export function HouseholdsPage() {
  const [q, setQ] = useState("");
  const typed = useDebouncedValue(q.trim());
  // The server searches 2 characters or more (S-20).
  const search = typed.length >= 2 ? typed : undefined;
  const [paging, setPaging] = useState({ key: "", page: 0 });
  const page = paging.key === (search ?? "") ? paging.page : 0;

  const input = { page, ...(search ? { search } : {}) };
  const { data, isPending, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["households", input],
    queryFn: () => listHouseholdsFn({ data: input }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.ok ? data.households : [];

  return (
    <>
      <PageHeader
        title="Households"
        description="Every home on Linara. Read-only: households are run from the household app."
        actions={
          <>
            <RefreshButton queryKeys={[["households"]]} updatedAt={dataUpdatedAt} />
            <ExportCsvButton slug="households" columns={HOUSEHOLD_CSV} rows={rows} />
          </>
        }
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SearchField value={q} onChange={setQ} label="Search household name" />
          </ListToolbar>
          <div className={isFetching && !isPending ? "opacity-60" : undefined}>
            {data && !data.ok ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="The households didn't load">{data.message}</EmptyState>
              </div>
            ) : (
              <DataTable
                label="Households"
                rows={rows}
                columns={columns}
                rowKey={(h) => h.householdId}
                empty={
                  isPending ? (
                    <TableSkeleton label="Loading households" />
                  ) : (
                    <EmptyState title="No households match">
                      Clear the search to see them all.
                    </EmptyState>
                  )
                }
                footer={
                  <ListPager
                    page={page}
                    hasMore={!!(data?.ok && data.hasMore)}
                    busy={isFetching}
                    onPage={(p) => setPaging({ key: search ?? "", page: p })}
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
