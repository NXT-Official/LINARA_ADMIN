import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DataTable, ListPager, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-button";
import { HiddenValue } from "@/components/shared/hidden-value";
import { ListToolbar, SegmentedFilter } from "@/components/shared/list-toolbar";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { PAYOUT_PROBLEM_TONE } from "@/components/shared/tones";
import { PAYOUT_PROBLEM_LABEL } from "@/data/labels";
import { revealPayoutAmountFn } from "@/features/pay/pay.actions";
import { formatDateTime, formatPeso } from "@/lib/format";

import { listPayoutProblemsFn } from "../payouts.actions";
import { PAYOUT_CSV } from "../payouts.export";
import type { ListPayoutProblemsInput } from "../payouts.handlers.server";
import { PAYOUT_KINDS, type PayoutKind, type PayoutProblem } from "../payouts.types";

/** Filters the list can start with, from a dashboard figure (FR-DB-8). */
export type PayoutFilters = { kind?: PayoutKind };

const CHANNEL: Record<string, string> = { PH_GCASH: "GCash", PH_PAYMAYA: "Maya" };

async function revealAmount(attemptId: string): Promise<string> {
  const res = await revealPayoutAmountFn({ data: { attemptId } });
  if (!res.ok) throw new Error(res.message);
  return formatPeso(res.amount);
}

export function PayoutsPage({ initial = {} }: { initial?: PayoutFilters }) {
  const [kind, setKind] = useState<"all" | PayoutKind>(initial.kind ?? "all");
  const filterKey = kind;
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;

  const input: ListPayoutProblemsInput = { page, ...(kind !== "all" ? { kind } : {}) };
  const { data, isPending, isFetching } = useQuery({
    queryKey: ["payouts", "problems", input],
    queryFn: () => listPayoutProblemsFn({ data: input }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.ok ? data.problems : [];

  const columns: Column<PayoutProblem>[] = [
    {
      key: "helper",
      header: "Helper",
      mobile: "primary",
      cell: (p) => (
        <span className="font-semibold break-words text-foreground">
          {p.helperName ?? "Unknown helper"}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Problem",
      mobile: "primary",
      cell: (p) => (
        <StatusChip tone={PAYOUT_PROBLEM_TONE[p.kind]}>{PAYOUT_PROBLEM_LABEL[p.kind]}</StatusChip>
      ),
    },
    {
      key: "reason",
      header: "What Linara knows",
      className: "max-w-80",
      cell: (p) =>
        p.failureReason ? (
          <span className="break-words">{p.failureReason}</span>
        ) : (
          <span className="text-muted-foreground">No reason given</span>
        ),
    },
    {
      key: "household",
      header: "Household",
      cell: (p) =>
        p.householdId ? (
          <RecordLink to={`/households/${p.householdId}`}>
            {p.householdName ?? "Unnamed household"}
          </RecordLink>
        ) : (
          "Unknown"
        ),
    },
    {
      key: "amount",
      header: "Amount",
      cell: (p) => (
        <HiddenValue
          what={`${p.helperName ?? "this helper"}'s payout amount`}
          reveal={() => revealAmount(p.attemptId)}
        />
      ),
    },
    {
      key: "ref",
      header: "Xendit reference",
      mobile: "hidden",
      cell: (p) => (
        <div>
          <span className="tabular-nums break-all">{p.referenceId}</span>
          <div className="text-xs text-muted-foreground">
            {CHANNEL[p.channelCode] ?? p.channelCode}, attempt {p.attemptNumber}
          </div>
        </div>
      ),
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
        description="Wage payouts that failed, came back unclear, have been sending for over an hour, or got no answer from Xendit in a day. This screen only reads Linara's records and can't change a payout."
        actions={<ExportCsvButton slug="payout-problems" columns={PAYOUT_CSV} rows={rows} />}
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <ListToolbar>
            <SegmentedFilter
              label="Problem"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "All" },
                ...PAYOUT_KINDS.map((k) => ({ value: k, label: PAYOUT_PROBLEM_LABEL[k] })),
              ]}
            />
          </ListToolbar>
          <div className={isFetching && !isPending ? "opacity-60" : undefined}>
            {data && !data.ok ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState title="The payouts didn't load">{data.message}</EmptyState>
              </div>
            ) : (
              <DataTable
                label="Payouts with a problem"
                rows={rows}
                columns={columns}
                rowKey={(p) => p.attemptId}
                empty={
                  isPending ? (
                    <EmptyState title="Loading payouts" />
                  ) : (
                    <EmptyState title="No payout problems">
                      Every recent payout went through.
                    </EmptyState>
                  )
                }
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ListPager
                      page={page}
                      hasMore={!!(data?.ok && data.hasMore)}
                      busy={isFetching}
                      onPage={(p) => setPaging({ key: filterKey, page: p })}
                    />
                    <p className="text-xs text-muted-foreground">
                      To see the latest status, search the reference in the Xendit dashboard.
                    </p>
                  </div>
                }
              />
            )}
          </div>
        </div>
      </Surface>
    </>
  );
}
