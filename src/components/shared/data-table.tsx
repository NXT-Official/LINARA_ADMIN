import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  /**
   * How the column shows below `md`, where rows stack (NFR-3):
   * `primary` on the first line, `meta` on the line under it, `hidden` not at all.
   */
  mobile?: "primary" | "meta" | "hidden";
};

/**
 * A list on one surface. A table from `md`; below it each row stacks with the
 * key fields first, so the page never scrolls sideways (NFR-2).
 *
 * To make a row open a page, put a Link in a primary cell with
 * `className={rowLinkClass}`: the whole row becomes its hit area, and keyboard
 * users still tab to a real link.
 */
export const rowLinkClass =
  "font-semibold text-foreground hover:underline focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring";

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  footer,
  label,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: ReactNode;
  footer?: ReactNode;
  /** Names the table for screen readers. */
  label: string;
}) {
  if (rows.length === 0) return <div className="px-5 pb-6 pt-2 sm:px-6">{empty}</div>;

  const primary = columns.filter((c) => c.mobile === "primary");
  const meta = columns.filter((c) => (c.mobile ?? "meta") === "meta");

  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-3 py-2.5 text-xs font-semibold text-muted-foreground first:pl-6 last:pr-6",
                    c.align === "right" ? "text-right" : "text-left",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="relative transition-colors hover:bg-sand/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "h-12 px-3 py-2 align-middle first:pl-6 last:pr-6",
                      c.align === "right" && "text-right tabular-nums",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border border-t border-border md:hidden" aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="relative px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {primary.map((c) => (
                <div key={c.key} className="min-w-0 text-sm">
                  {c.cell(row)}
                </div>
              ))}
            </div>
            {meta.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {meta.map((c) => (
                  <span key={c.key} className="min-w-0">
                    <span className="sr-only">{c.header}: </span>
                    {c.cell(row)}
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {footer ? <div className="border-t border-border px-5 py-3 sm:px-6">{footer}</div> : null}
    </>
  );
}

/** "Showing 1 to 8 of 8". Server pagination (50 a page, NFR-7) plugs in here. */
export function ListFooter({ shown, total }: { shown: number; total: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      {total === 0 ? "No rows" : `Showing 1 to ${shown} of ${total}`}
    </p>
  );
}
