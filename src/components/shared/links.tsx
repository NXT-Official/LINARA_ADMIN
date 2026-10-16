import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { rowLinkClass } from "./data-table";

/** The link that makes a whole list row open its page. */
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={rowLinkClass}>
      {children}
    </Link>
  );
}

/** An inline link to another record, e.g. a household from a user's page. */
export function RecordLink({
  to,
  children,
  className,
}: {
  /** A path, optionally with a query string such as `/team?tab=roles`. */
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const [path, query] = to.split("?");
  return (
    <Link
      to={path}
      search={query ? Object.fromEntries(new URLSearchParams(query)) : undefined}
      className={cn(
        "relative z-10 font-semibold text-pine underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** "Back to CRM" above a detail page's title. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {children}
    </Link>
  );
}
