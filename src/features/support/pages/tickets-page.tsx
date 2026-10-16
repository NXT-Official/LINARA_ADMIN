import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { DataTable, ListPager, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { ListToolbar, SearchField, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RowLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { PRIORITY_TONE, TICKET_STATUS_TONE } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABEL, PRIORITY_LABEL, TICKET_STATUS_LABEL } from "@/data/labels";
import { useAdmins } from "@/features/team/use-admins";
import { formatRelativeDay } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { LogTicketDialog } from "../components/log-ticket-dialog";
import { listTicketsFn } from "../support.actions";
import { TICKET_CSV } from "../support.export";
import type { ListTicketsInput } from "../support.handlers.server";
import { ticketRef } from "../support.input";
import type { TicketRow, TicketStatus } from "../support.types";

type View = "active" | TicketStatus;

/** Filters the list can start with, from a dashboard figure (FR-DB-8). */
export type TicketFilters = { status?: View; assignee?: "mine" | "unassigned" };

export function TicketsPage({ initial = {} }: { initial?: TicketFilters }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const admins = useAdmins();
  const [view, setView] = useState<View>(initial.status ?? "active");
  const [who, setWho] = useState<"anyone" | "mine" | "unassigned">(initial.assignee ?? "anyone");
  const [q, setQ] = useState("");
  const typed = useDebouncedValue(q.trim());

  const filters: Omit<ListTicketsInput, "page"> = {
    status: view,
    ...(who !== "anyone" ? { assignee: who } : {}),
    ...(typed.length >= 2 ? { search: typed } : {}),
  };
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;

  const input: ListTicketsInput = { page, ...filters };
  const { data, isPending, isFetching } = useQuery({
    queryKey: ["support", "tickets", input],
    queryFn: () => listTicketsFn({ data: input }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.ok ? data.tickets : [];

  const columns: Column<TicketRow>[] = [
    {
      key: "subject",
      header: "Ticket",
      mobile: "primary",
      cell: (t) => (
        <div className="min-w-0">
          <RowLink to={`/support/${t.ticketId}`}>{t.subject}</RowLink>
          <div className="text-xs text-muted-foreground">
            {ticketRef(t.ref)}
            {t.contact ? `, ${t.contact}` : ""}
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
          admins.name(t.assigneeId)
        ) : (
          <span className="font-semibold text-terracotta-ink">No one</span>
        ),
    },
    { key: "updated", header: "Updated", cell: (t) => formatRelativeDay(t.updatedAt) },
  ];

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
              onLogged={(ticketId) => {
                void queryClient.invalidateQueries({ queryKey: ["support"] });
                void navigate({ to: `/support/${ticketId}` });
              }}
            />
          </>
        }
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Status"
              value={view}
              onChange={setView}
              options={[
                { value: "active", label: "Open or waiting" },
                { value: "open", label: "Open" },
                { value: "pending", label: "Waiting on user" },
                { value: "resolved", label: "Resolved" },
                { value: "closed", label: "Closed" },
              ]}
            />
            <SegmentedFilter
              label="Assigned to"
              value={who}
              onChange={setWho}
              options={[
                { value: "anyone", label: "Anyone" },
                { value: "mine", label: "Mine" },
                { value: "unassigned", label: "No one" },
              ]}
            />
            <SearchField
              value={q}
              onChange={setQ}
              label="Search subject, contact or LIN number"
              className="sm:ml-auto"
            />
          </ListToolbar>
          <div className={isFetching && !isPending ? "opacity-60" : undefined}>
            {data && !data.ok ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="The tickets didn't load">{data.message}</EmptyState>
              </div>
            ) : (
              <DataTable
                label="Support tickets"
                rows={rows}
                columns={columns}
                rowKey={(t) => t.ticketId}
                empty={
                  <EmptyState title={isPending ? "Loading tickets" : "No tickets match"}>
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
