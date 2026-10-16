import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A screen's title row: the heading, one line of context, and its actions. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A link back to the list this page came from. */
  back?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? <div className="mb-2">{back}</div> : null}
        <h1 className="text-2xl leading-tight break-words text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div> : null}
    </header>
  );
}

/**
 * One Cream surface per section (LINARA DESIGN.md). Rows inside are split by
 * hairlines, never boxed again.
 */
export function Surface({
  title,
  description,
  actions,
  children,
  className,
  flush = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content runs edge to edge (tables, row lists). */
  flush?: boolean;
}) {
  return (
    <section className={cn("rounded-3xl bg-card shadow-soft", className)}>
      {title ? (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg leading-snug text-foreground">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? (title ? "mt-3" : "") : "p-5 sm:p-6", title && !flush && "pt-3")}>
        {children}
      </div>
    </section>
  );
}

/** Label and value pairs, e.g. a profile's details. */
export function DetailList({
  items,
}: {
  items: { label: string; value: ReactNode; hidden?: boolean }[];
}) {
  return (
    <dl className="divide-y divide-border">
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div
            key={i.label}
            className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="text-xs font-semibold text-muted-foreground">{i.label}</dt>
            <dd className="min-w-0 break-words text-sm text-foreground">{i.value}</dd>
          </div>
        ))}
    </dl>
  );
}
