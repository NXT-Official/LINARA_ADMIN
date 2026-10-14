import { useState } from "react";

import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { USER_KIND_LABEL } from "@/data/labels";
import { householdById, listUsers } from "@/data/queries";
import type { AppUser } from "@/data/types";
import { ExportCsvButton } from "@/components/shared/export-button";

import { formatDate, formatRelativeDay } from "@/lib/format";
import { USER_CSV } from "../users.export";

type View = "all" | "managers" | "helpers" | "suspended";

export function UsersPage() {
  const all = listUsers();
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");

  const rows = all.filter((u) => {
    if (view === "managers" && u.kind === "helper") return false;
    if (view === "helpers" && u.kind !== "helper") return false;
    if (view === "suspended" && u.status !== "suspended") return false;
    const needle = q.trim().toLowerCase();
    return !needle || [u.fullName, u.email, u.phone].some((v) => v?.toLowerCase().includes(needle));
  });

  const columns: Column<AppUser>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "primary",
      cell: (u) => (
        <div className="min-w-0">
          <RowLink to={`/users/${u.id}`}>{u.fullName}</RowLink>
          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "primary",
      cell: (u) =>
        u.status === "suspended" ? (
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
        const first = householdById(u.householdIds[0] ?? null);
        if (!first) return <span className="text-muted-foreground">None</span>;
        const more = u.householdIds.length - 1;
        return (
          <span className="line-clamp-1">
            {first.name}
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

  const count = (v: View) =>
    all.filter((u) =>
      v === "all"
        ? true
        : v === "managers"
          ? u.kind !== "helper"
          : v === "helpers"
            ? u.kind === "helper"
            : u.status === "suspended",
    ).length;

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
            <SegmentedFilter
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: "all", label: "All", count: count("all") },
                { value: "managers", label: "Managers", count: count("managers") },
                { value: "helpers", label: "Helpers", count: count("helpers") },
                { value: "suspended", label: "Suspended", count: count("suspended") },
              ]}
            />
            <SearchField
              value={q}
              onChange={setQ}
              label="Search name, email or phone"
              className="sm:ml-auto"
            />
          </ListToolbar>
          <DataTable
            label="Users"
            rows={rows}
            columns={columns}
            rowKey={(u) => u.id}
            empty={
              <EmptyState title="No users match">
                Try another filter, or clear the search.
              </EmptyState>
            }
            footer={<ListFooter shown={rows.length} total={rows.length} />}
          />
        </div>
      </Surface>
    </>
  );
}
