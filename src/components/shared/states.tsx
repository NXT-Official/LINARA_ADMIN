import type { ReactNode } from "react";
import { Lock } from "lucide-react";

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
 * A number that can't be worked out. Shown instead of a zero, with the reason
 * (FR-DB-9).
 */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <span className="text-sm text-muted-foreground" title={reason}>
      Unavailable <span className="sr-only">: {reason}</span>
    </span>
  );
}

/** A screen the admin's role doesn't cover (spec §7.3, per-screen check). */
export function RestrictedPanel({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-md rounded-3xl bg-card p-7 text-center shadow-soft">
      <Lock className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-3 text-xl text-foreground">Restricted</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your role doesn't cover {what}.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Ask an admin if you need it. <RecordLink to="/">Go to the dashboard</RecordLink>
      </p>
    </div>
  );
}
