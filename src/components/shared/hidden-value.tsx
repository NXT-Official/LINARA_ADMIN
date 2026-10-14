import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Pay data is hidden until asked for, and each reveal is recorded (FR-US-6,
 * S-17). The button names what it shows, so it is never an icon on its own.
 */
export function HiddenValue({
  value,
  what,
  onReveal,
}: {
  value: string;
  /** e.g. "wage". Used in the button's accessible name. */
  what: string;
  onReveal?: () => void;
}) {
  const [shown, setShown] = useState(false);
  if (shown) return <span className="tabular-nums text-foreground">{value}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-4 w-16 rounded-md bg-sand-deep" />
      <span className="sr-only">Hidden</span>
      <Button
        size="sm"
        variant="outline"
        className="relative z-10 h-7 px-2.5"
        aria-label={`Show ${what}`}
        onClick={() => {
          setShown(true);
          onReveal?.();
        }}
      >
        Show
      </Button>
    </span>
  );
}
