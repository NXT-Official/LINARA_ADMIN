import type { ReactNode } from "react";
import { Lock } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/i18n";

import { RecordLink } from "./links";

/** An empty list: says what's missing and what to do next. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/**
 * A list's shape while it loads: hairline rows of soft bars. Screen readers
 * hear the label ("Loading contacts") once.
 */
export function TableSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-border px-5 pb-4 sm:px-6">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex h-12 items-center gap-4">
          <Skeleton className="h-3.5 w-2/5 max-w-56" />
          <Skeleton className="hidden h-3.5 w-24 md:block" />
          <Skeleton className="hidden h-3.5 w-32 md:block" />
          <Skeleton className="ml-auto h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Label-and-figure rows (the dashboard's sections) while they load. */
export function FiguresSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-border">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-5 w-10" />
        </div>
      ))}
    </div>
  );
}

/** A record page (user, household, contact, ticket) while it loads. */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="mb-6 space-y-3">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div aria-hidden="true" className="space-y-4 rounded-3xl bg-card p-5 shadow-soft sm:p-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A number that can't be worked out. Shown instead of a zero, with the reason
 * (FR-DB-9).
 */
export function Unavailable({ reason }: { reason: string }) {
  const t = useT();
  return (
    <span className="text-sm text-muted-foreground" title={reason}>
      {t("states.unavailable")} <span className="sr-only">: {reason}</span>
    </span>
  );
}

/** A screen the admin's role doesn't cover (spec §7.3, per-screen check). */
export function RestrictedPanel() {
  const t = useT();
  return (
    <div className="mx-auto max-w-md rounded-3xl bg-card p-7 text-center shadow-soft">
      <Lock className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-3 text-xl text-foreground">{t("states.restricted")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("states.notCovered")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("states.askAdmin")} <RecordLink to="/">{t("states.goToDashboard")}</RecordLink>
      </p>
    </div>
  );
}
