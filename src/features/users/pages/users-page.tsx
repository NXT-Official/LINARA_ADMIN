import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DataTable, ListPager, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { USER_KIND_LABEL } from "@/data/labels";
import { formatDate, formatRelativeDay } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { listUsersFn } from "../users.actions";
import { USER_CSV } from "../users.export";
import type { UserKind, UserRow } from "../users.types";

type View = "all" | UserKind;

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "primary_manager", label: "Primary managers" },
  { value: "co_manager", label: "Co-managers" },
  { value: "remote_admin", label: "Remote admins" },
  { value: "helper", label: "Helpers" },
];

const columns: Column<UserRow>[] = [
  {
    key: "name",
    header: "Name",
    mobile: "primary",
    cell: (u) => (
      <div className="min-w-0">
        <RowLink to={`/users/${u.userId}`}>{u.fullName}</RowLink>
        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    mobile: "primary",
    cell: (u) =>
      u.suspended ? (
        <StatusChip tone="danger">Suspended</StatusChip>
      ) : (
        <span className="text-muted-foreground">Active</span>
      ),
  },
  { key: "kind", header: "Role", cell: (u) => USER_KIND_LABEL[u.kind] },
  {
    key: "household",
    header: "Household",
    cell: (u) => {
      if (u.householdCount === 0 || !u.householdName) {
        return <span className="text-muted-foreground">None</span>;
      }
      const more = u.householdCount - 1;
      return (
        <span className="line-clamp-1">
          {u.householdName}
          {more > 0 ? <span className="text-muted-foreground"> and {more} more</span> : null}
        </span>
      );
    },
  },
  { key: "joined", header: "Joined", mobile: "hidden", cell: (u) => formatDate(u.joinedAt) },
  {
    key: "seen",
    header: "Last sign-in",
    cell: (u) => (u.lastSignInAt ? formatRelativeDay(u.lastSignInAt) : "Never"),
  },
];

export function UsersPage() {
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const typed = useDebouncedValue(q.trim());
  // The server searches 2 characters or more (S-20); one character lists everyone.
  const search = typed.length >= 2 ? typed : undefined;
  const kind = view === "all" ? undefined : view;

  // A new search or filter starts again at the first page.
  const filterKey = `${search ?? ""}|${kind ?? ""}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;

  const input = { page, ...(search ? { search } : {}), ...(kind ? { kind } : {}) };
  const { data, isPending, isFetching } = useQuery({
    queryKey: ["users", input],
    queryFn: () => listUsersFn({ data: input }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.ok ? data.users : [];

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with a Linara account: household managers and helpers."
        actions={<ExportCsvButton slug="users" columns={USER_CSV} rows={rows} />}
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter label="Show" value={view} onChange={setView} options={VIEWS} />
            <SearchField
              value={q}
              onChange={setQ}
              label="Search name, email or phone"
              className="sm:ml-auto"
            />
          </ListToolbar>
          <div className={isFetching && !isPending ? "opacity-60" : undefined}>
            {data && !data.ok ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="The users didn't load">{data.message}</EmptyState>
              </div>
            ) : (
              <DataTable
                label="Users"
                rows={rows}
                columns={columns}
                rowKey={(u) => u.userId}
                empty={
                  <EmptyState title={isPending ? "Loading users" : "No users match"}>
                    {isPending ? null : "Try another filter, or clear the search."}
                  </EmptyState>
                }
                footer={
                  <ListPager
                    page={page}
                    hasMore={!!(data?.ok && data.hasMore)}
                    busy={isFetching}
                    onPage={(p) => setPaging({ key: filterKey, page: p })}
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
