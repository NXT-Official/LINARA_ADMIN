import { useState } from "react";
import { Plus } from "lucide-react";

import { BarList, ChartSurface, type ChartPoint } from "@/components/shared/charts";
import { DataTable, ListFooter, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { PRIORITY_TONE, TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { CURRENT_STAFF_ID } from "@/data/sample";
import { CATEGORY_LABEL, CHANNEL_LABEL, PRIORITY_LABEL, TICKET_STATUS_LABEL } from "@/data/labels";
import { listTickets, staffById, ticketsByCategory30d, ticketsByChannel30d } from "@/data/queries";
import type { Ticket, TicketCategory, TicketChannel, TicketStatus } from "@/data/types";

import { formatRelativeDay } from "@/lib/format";
import { TICKET_CSV } from "../support.export";

import { LogTicketDialog } from "../components/log-ticket-dialog";

type View = TicketStatus | "all";

function SupportCharts() {
  const byCategory: ChartPoint[] = Object.entries(ticketsByCategory30d())
    .map(([key, value]) => ({ key, value, label: CATEGORY_LABEL[key as TicketCategory] ?? key }))
    .sort((a, b) => b.value - a.value);
  const byChannel: ChartPoint[] = Object.entries(ticketsByChannel30d())
    .map(([key, value]) => ({ key, value, label: CHANNEL_LABEL[key as TicketChannel] ?? key }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <ChartSurface
        title="What people need help with"
        description="Tickets logged in the last 30 days"
        slug="support-by-category"
        labelHeader="category"
        valueHeader="tickets"
        data={byCategory}
        height="h-auto"
        chart={<BarList data={byCategory} unit="tickets" />}
      />
      <ChartSurface
        title="Where requests come in"
        description="Tickets logged in the last 30 days"
        slug="support-by-channel"
        labelHeader="channel"
        valueHeader="tickets"
        data={byChannel}
        height="h-auto"
        chart={<BarList data={byChannel} unit="tickets" />}
      />
    </div>
  );
}

export function TicketsPage() {
  const all = listTickets();
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((t) => view === "all" || t.status === view)
    .filter(
      (t) =>
        !needle ||
        `lin-${t.ref}`.includes(needle) ||
        t.subject.toLowerCase().includes(needle) ||
        t.contactHandle?.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const columns: Column<Ticket>[] = [
    {
      key: "subject",
      header: "Ticket",
      mobile: "primary",
      cell: (t) => (
        <div className="min-w-0">
          <RowLink to={`/support/${t.id}`}>{t.subject}</RowLink>
          <div className="text-xs text-muted-foreground">
            LIN-{t.ref}
            {t.contactHandle ? `, ${t.contactHandle}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "primary",
      cell: (t) => (
        <StatusChip tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</StatusChip>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      cell: (t) =>
        t.priority === "normal" ? (
          <span className="text-muted-foreground">Normal</span>
        ) : (
          <StatusChip tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusChip>
        ),
    },
    { key: "channel", header: "Channel", mobile: "hidden", cell: (t) => CHANNEL_LABEL[t.channel] },
    {
      key: "assignee",
      header: "Assigned to",
      cell: (t) =>
        t.assigneeId ? (
          t.assigneeId === CURRENT_STAFF_ID ? (
            "You"
          ) : (
            staffById(t.assigneeId)?.fullName
          )
        ) : (
          <span className="font-semibold text-terracotta-ink">No one</span>
        ),
    },
    { key: "updated", header: "Updated", cell: (t) => formatRelativeDay(t.updatedAt) },
  ];

  const count = (s: View) => all.filter((t) => s === "all" || t.status === s).length;

  return (
    <>
      <PageHeader
        title="Support"
        description="Requests from Messenger, Viber, email and calls. Reply on the original channel, then log it as a note."
        actions={
          <>
            <ExportCsvButton slug="support-tickets" columns={TICKET_CSV} rows={rows} />
            <LogTicketDialog
              trigger={
                <Button>
                  <Plus />
                  Log ticket
                </Button>
              }
            />
          </>
        }
      />
      <SupportCharts />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Status"
              value={view}
              onChange={setView}
              options={[
                { value: "open", label: "Open", count: count("open") },
                { value: "pending", label: "Waiting on user", count: count("pending") },
                { value: "resolved", label: "Resolved", count: count("resolved") },
                { value: "closed", label: "Closed", count: count("closed") },
                { value: "all", label: "All", count: count("all") },
              ]}
            />
            <SearchField
              value={q}
              onChange={setQ}
              label="Search LIN number, subject or name"
              className="sm:ml-auto"
            />
          </ListToolbar>
          <DataTable
            label="Tickets"
            rows={rows}
            columns={columns}
            rowKey={(t) => t.id}
            empty={
              <EmptyState title={view === "open" ? "No open tickets" : "No tickets match"}>
                {view === "open"
                  ? "Log one when a request comes in on another channel."
                  : "Try another status."}
              </EmptyState>
            }
            footer={<ListFooter shown={rows.length} total={rows.length} />}
          />
        </div>
      </Surface>
    </>
  );
}
