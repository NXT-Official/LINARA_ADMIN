import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";

import { resetCatalog } from "../plans.store";

/** The header actions every D47 screen carries: it says it's sample data, and resets. */
export function SampleActions() {
  return (
    <>
      <StatusChip tone="attention" className="self-center">
        Sample data
      </StatusChip>
      <Button variant="outline" onClick={resetCatalog}>
        Reset sample
      </Button>
    </>
  );
}

export const SAMPLE_NOTE = "Sample data: nothing was saved.";
