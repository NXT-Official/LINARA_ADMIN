import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A state, never an action (the Pills-Mean-Status Rule). Text always uses the
 * `-ink` value of its tint so it stays at 4.5:1 or better.
 */
export type ChipTone = "neutral" | "done" | "late" | "attention" | "danger" | "quiet";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-sand-deep text-pine-deep",
  done: "bg-status-done-soft text-status-done-ink",
  late: "bg-status-late-soft text-status-late-ink",
  attention: "bg-terracotta-soft text-hearth-ink",
  danger: "bg-destructive/10 text-destructive",
  quiet: "bg-transparent text-muted-foreground ring-1 ring-inset ring-border",
};

export function StatusChip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
