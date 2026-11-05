import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, MoreHorizontal, Plus, Upload } from "lucide-react";

import { DataTable, ListPager, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { RefreshButton } from "@/components/shared/refresh-button";
import { SelectField } from "@/components/shared/form";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState, TableSkeleton } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { STAGE_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  CUSTOMER_STAGE_LABEL,
  LEAD_STAGE_LABEL,
  SOURCE_LABEL,
  USER_KIND_LABEL,
} from "@/data/labels";
import { useCan } from "@/features/auth/use-can";
import { useAdmins } from "@/features/team/use-admins";
import { daysBetween, formatRelativeDay } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

import { CrmCharts } from "../components/crm-charts";
import { AddLeadDialog, ExportDialog } from "../components/crm-dialogs";
import { crmDashboardFn, listContactsFn } from "../crm.actions";
import { CONTACT_CSV } from "../crm.export";
import type { ListContactsInput } from "../crm.handlers.server";
import {
  CUSTOMER_STAGES,
  LEAD_STAGES,
  MANAGER_ROLES,
  type ContactKind,
  type ContactRow,
  type ManagerRole,
} from "../crm.types";
import { contactHref, stageLabel } from "../crm.utils";

const ANY = "any";

/** Filters the list can start with, e.g. from a dashboard figure (FR-DB-8). */
export type ContactFilters = {
  kind?: ContactKind;
  stage?: string;
  due?: "today" | "overdue";
};

const STAGE_OPTIONS = [
  { value: ANY, label: "Any stage" },
  ...LEAD_STAGES.map((s) => ({ value: s, label: `Lead: ${LEAD_STAGE_LABEL[s]}` })),
  ...CUSTOMER_STAGES.map((s) => ({ value: s, label: `Customer: ${CUSTOMER_STAGE_LABEL[s]}` })),
];
const ROLE_OPTIONS = [
  { value: ANY, label: "Any role" },
  ...MANAGER_ROLES.map((r) => ({ value: r, label: USER_KIND_LABEL[r] })),
];

export function ContactsPage({ initial = {} }: { initial?: ContactFilters }) {
  const queryClient = useQueryClient();
  const admins = useAdmins();
  const can = useCan();
  const [kind, setKind] = useState<ContactKind | "all">(initial.kind ?? "all");
  const [stage, setStage] = useState<string>(initial.stage ?? ANY);
  const [role, setRole] = useState<ManagerRole | typeof ANY>(ANY);
  const [owner, setOwner] = useState<"everyone" | "mine">("everyone");
  const [due, setDue] = useState<"any" | "today" | "overdue">(initial.due ?? "any");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const typed = useDebouncedValue(q.trim());

  const filters: Omit<ListContactsInput, "page"> = {
    ...(typed.length >= 2 ? { search: typed } : {}),
    ...(kind !== "all" ? { kind } : {}),
    ...(stage !== ANY ? { stage } : {}),
    ...(role !== ANY ? { role } : {}),
    ...(owner === "mine" ? { owner: "mine" as const } : {}),
    ...(due !== "any" ? { due } : {}),
  };
  // A new filter starts again at the first page.
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;

  const input: ListContactsInput = { page, ...filters };
  const { data, isPending, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["crm", "contacts", input],
    queryFn: () => listContactsFn({ data: input }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.ok ? data.contacts : [];
  // Shares the dashboard's CRM query: one call for both screens' figures.
  const { data: figures } = useQuery({
    queryKey: ["crm", "dashboard"],
    queryFn: () => crmDashboardFn(),
  });
  const now = new Date();

  const columns: Column<ContactRow>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "primary",
      cell: (c) => (
        <div className="min-w-0">
          <RowLink to={contactHref(c)}>{c.fullName}</RowLink>
          <div className="truncate text-xs text-muted-foreground">
            {c.email ?? c.phone ?? "No email or phone"}
          </div>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      mobile: "primary",
      cell: (c) => (
        <span className="inline-flex items-center gap-2">
          <StatusChip tone={STAGE_TONE[c.stage]}>{stageLabel(c)}</StatusChip>
          <span className="text-xs text-muted-foreground">
            {c.kind === "lead" ? "Lead" : "Customer"}
          </span>
        </span>
      ),
    },
    {
      key: "follow",
      header: "Next follow-up",
      cell: (c) =>
        c.nextFollowUpAt ? (
          <span
            className={cn(
              daysBetween(now, c.nextFollowUpAt) < 0 && "font-semibold text-status-late-ink",
            )}
          >
            {formatRelativeDay(c.nextFollowUpAt, now)}
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (c) =>
        admins.name(c.ownerId) ?? <span className="text-muted-foreground">No owner</span>,
    },
    {
      key: "source",
      header: "Source",
      mobile: "hidden",
      cell: (c) =>
        c.source ? (
          SOURCE_LABEL[c.source]
        ) : (
          <span className="text-muted-foreground">
            {c.kind === "customer" ? "Signed up" : "Not set"}
          </span>
        ),
    },
    {
      key: "tags",
      header: "Tags",
      mobile: "hidden",
      className: "max-w-56",
      cell: (c) => <span className="line-clamp-1 text-muted-foreground">{c.tags.join(", ")}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="CRM"
        description="Leads and customers in one list. Every manager on Linara shows here as a customer."
        actions={
          <>
            <RefreshButton queryKeys={[["crm"]]} updatedAt={dataUpdatedAt} />
            <ExportCsvButton slug="crm-contacts" columns={CONTACT_CSV} rows={rows} />
            {can("crm.write") || can("crm.export") ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More CRM actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 rounded-xl">
                  {can("crm.write") ? (
                    <DropdownMenuItem asChild>
                      <Link to="/crm/import">
                        <Upload aria-hidden="true" />
                        Import leads from CSV
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {can("crm.export") ? (
                    <DropdownMenuItem onSelect={() => setExporting(true)}>
                      <Download aria-hidden="true" />
                      Export with contact details
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <ExportDialog open={exporting} onOpenChange={setExporting} filters={filters} />
            {can("crm.write") ? (
              <AddLeadDialog
                trigger={
                  <Button>
                    <Plus />
                    Add lead
                  </Button>
                }
                onAdded={() => queryClient.invalidateQueries({ queryKey: ["crm"] })}
              />
            ) : null}
          </>
        }
      />
      {figures?.ok ? <CrmCharts crm={figures.crm} /> : null}
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Show"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "All" },
                { value: "lead", label: "Leads" },
                { value: "customer", label: "Customers" },
              ]}
            />
            <SegmentedFilter
              label="Owner"
              value={owner}
              onChange={setOwner}
              options={[
                { value: "everyone", label: "Everyone" },
                { value: "mine", label: "Mine" },
              ]}
            />
            <SegmentedFilter
              label="Follow-ups"
              value={due}
              onChange={setDue}
              options={[
                { value: "any", label: "Any" },
                { value: "today", label: "Due today" },
                { value: "overdue", label: "Overdue" },
              ]}
            />
          </ListToolbar>
          <ListToolbar>
            <div className="grid gap-2 sm:w-56">
              <Label htmlFor="crm-stage" className="sr-only">
                Stage
              </Label>
              <SelectField
                id="crm-stage"
                value={stage}
                onChange={setStage}
                options={STAGE_OPTIONS}
              />
            </div>
            <div className="grid gap-2 sm:w-48">
              <Label htmlFor="crm-role" className="sr-only">
                Manager role
              </Label>
              <SelectField
                id="crm-role"
                value={role}
                onChange={(v) => setRole(v as ManagerRole | typeof ANY)}
                options={ROLE_OPTIONS}
              />
            </div>
            <SearchField
              value={q}
              onChange={setQ}
              label="Search name, email, phone or tag"
              className="sm:ml-auto"
            />
          </ListToolbar>
          <div className={isFetching && !isPending ? "opacity-60" : undefined}>
            {data && !data.ok ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="The contacts didn't load">{data.message}</EmptyState>
              </div>
            ) : (
              <DataTable
                label="Contacts"
                rows={rows}
                columns={columns}
                rowKey={(c) => c.contactId ?? `user-${c.userId}`}
                empty={
                  isPending ? (
                    <TableSkeleton label="Loading contacts" />
                  ) : (
                    <EmptyState title="No contacts match">
                      Try another filter, or clear the search.
                    </EmptyState>
                  )
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
