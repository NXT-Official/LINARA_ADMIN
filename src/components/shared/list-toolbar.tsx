import type { ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The search box and filters above a list. */
export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-5 pb-1 sm:flex-row sm:flex-wrap sm:px-6">{children}</div>
  );
}

export function SearchField({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Also the placeholder, e.g. "Search by name, email or phone". */
  label: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block sm:w-80", className)}>
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className="pl-9"
      />
    </label>
  );
}

/**
 * A row of mutually exclusive filters (soft rectangles: they act, so they are
 * not pills). Scrolls inside itself on a phone instead of the page.
 */
export function SegmentedFilter<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl bg-sand-deep/70 p-1 sm:mx-0 sm:w-fit"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors pointer-coarse:h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-pine shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span
                className={cn("tabular-nums", active ? "text-pine-deep" : "text-muted-foreground")}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
