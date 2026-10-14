import { useMemo, useState } from "react";
import { Download, MoreHorizontal, Plus, Upload } from "lucide-react";

import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { STAGE_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CURRENT_STAFF_ID } from "@/data/sample";
import { SOURCE_LABEL } from "@/data/labels";
import { listContacts, staffById, type ContactRow } from "@/data/queries";
import { daysBetween, formatRelativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AddLeadDialog, ExportDialog, ImportDialog } from "../components/crm-dialogs";
import { CrmCharts } from "../components/crm-charts";
import { CONTACT_CSV } from "../crm.export";
import { hasDueFollowUp, stageLabel } from "../crm.utils";

type View = "all" | "leads" | "customers" | "due";

export function ContactsPage() {
  const now = useMemo(() => new Date(), []);
  const all = useMemo(() => listContacts(now), [now]);
  const [view, setView] = useState<View>("all");
  const [owner, setOwner] = useState<"everyone" | "mine">("everyone");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<"import" | "export" | null>(null);

  const rows = all.filter((c) => {
    if (view === "leads" && c.kind !== "lead") return false;
    if (view === "customers" && c.kind !== "customer") return false;
    if (view === "due" && !hasDueFollowUp(c, now)) return false;
    if (owner === "mine" && c.ownerId !== CURRENT_STAFF_ID) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [c.fullName, c.email, c.phone, ...c.tags]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(needle));
  });

  const columns: Column<ContactRow>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "primary",
      cell: (c) => (
        <div className="min-w-0">
          <RowLink to={`/crm/${c.id}`}>{c.fullName}</RowLink>
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
        c.nextFollowUp ? (
          <span
            className={cn(
              daysBetween(now, c.nextFollowUp.dueAt) < 0 && "font-semibold text-status-late-ink",
            )}
          >
            {formatRelativeDay(c.nextFollowUp.dueAt, now)}
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (c) =>
        c.ownerId === CURRENT_STAFF_ID ? "You" : (staffById(c.ownerId)?.fullName ?? "No owner"),
    },
    {
      key: "source",
      header: "Source",
      mobile: "hidden",
      cell: (c) =>
        c.source ? (
          SOURCE_LABEL[c.source]
        ) : (
          <span className="text-muted-foreground">Signed up</span>
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

  const count = (v: View) =>
    all.filter((c) =>
      v === "all"
        ? true
        : v === "due"
          ? hasDueFollowUp(c, now)
          : c.kind === (v === "leads" ? "lead" : "customer"),
    ).length;

  return (
    <>
      <PageHeader
        title="CRM"
        description="Leads and customers in one list. Every manager on Linara shows here as a customer."
        actions={
          <>
            <ExportCsvButton slug="crm-contacts" columns={CONTACT_CSV} rows={rows} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More CRM actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-xl">
                <DropdownMenuItem onSelect={() => setDialog("import")}>
                  <Upload aria-hidden="true" />
                  Import leads from CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("export")}>
                  <Download aria-hidden="true" />
                  Export with contact details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ImportDialog open={dialog === "import"} onOpenChange={(o) => !o && setDialog(null)} />
            <ExportDialog
              count={rows.length}
              open={dialog === "export"}
              onOpenChange={(o) => !o && setDialog(null)}
            />
            <AddLeadDialog
              trigger={
                <Button>
                  <Plus />
                  Add lead
                </Button>
              }
            />
          </>
        }
      />
      <CrmCharts contacts={all} />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: "all", label: "All", count: count("all") },
                { value: "leads", label: "Leads", count: count("leads") },
                { value: "customers", label: "Customers", count: count("customers") },
                { value: "due", label: "Follow-up due", count: count("due") },
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
            <SearchField
              value={q}
              onChange={setQ}
              label="Search name, email, phone or tag"
              className="sm:ml-auto"
            />
          </ListToolbar>
          <DataTable
            label="Contacts"
            rows={rows}
            columns={columns}
            rowKey={(c) => c.id}
            empty={
              <EmptyState title="No contacts match">
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
