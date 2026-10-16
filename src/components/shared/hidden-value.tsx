import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/use-can";

type State =
  | { kind: "hidden"; error: string | null }
  | { kind: "loading" }
  | { kind: "shown"; value: string | null };

/**
 * Pay data is hidden until asked for, and each reveal is recorded (FR-US-6,
 * S-17). The value isn't in the page until the click: `reveal` fetches it
 * from the server, which records the reveal first. The button names what it
 * shows, so it is never an icon on its own.
 */
export function HiddenValue({
  what,
  reveal,
}: {
  /** e.g. "Carla's wage". Used in the button's accessible name. */
  what: string;
  /** Resolves to the text to show, or null when there's nothing set. Rejects with a plain message. */
  reveal: () => Promise<string | null>;
}) {
  const [state, setState] = useState<State>({ kind: "hidden", error: null });
  const canReveal = useCan()("pay.view");

  if (!canReveal) {
    return (
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="h-4 w-16 rounded-md bg-sand-deep" />
        <span className="sr-only">Hidden</span>
      </span>
    );
  }

  if (state.kind === "shown") {
    return state.value === null ? (
      <span className="text-muted-foreground">Not set</span>
    ) : (
      <span className="tabular-nums text-foreground">{state.value}</span>
    );
  }

  const loading = state.kind === "loading";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="h-4 w-16 rounded-md bg-sand-deep" />
      <span className="sr-only">Hidden</span>
      <Button
        size="sm"
        variant="outline"
        className="relative z-10 h-7 px-2.5"
        aria-label={`Show ${what}`}
        disabled={loading}
        onClick={() => {
          if (loading) return;
          setState({ kind: "loading" });
          reveal().then(
            (value) => setState({ kind: "shown", value }),
            (e: unknown) =>
              setState({
                kind: "hidden",
                error:
                  e instanceof Error && e.message
                    ? e.message
                    : "Something went wrong on our side. Try again.",
              }),
          );
        }}
      >
        {loading ? "Showing" : "Show"}
      </Button>
      {state.kind === "hidden" && state.error ? (
        <span role="alert" className="text-xs text-status-late-ink">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
