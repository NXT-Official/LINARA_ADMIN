import { useEffect } from "react";

import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";

import { loadLiveBilling, resetCatalog, useBillingMode } from "../plans.store";

let requested = false;

/**
 * The header actions every billing screen carries. Loads the real data once
 * (D48); until then, and where billing isn't set up in the database, the
 * screens run on the D47 sample and say so.
 */
export function SampleActions() {
  const { live, testTools, loading } = useBillingMode();
  useEffect(() => {
    if (requested) return;
    requested = true;
    void loadLiveBilling();
  }, []);
  if (live) {
    return (
      <>
        {testTools ? (
          <StatusChip tone="attention" className="self-center">
            Test tools on
          </StatusChip>
        ) : null}
        <Button variant="outline" onClick={resetCatalog} disabled={loading}>
          Refresh
        </Button>
      </>
    );
  }
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

/**
 * Added to what the screens say after a change: "Sample data: nothing was
 * saved." on the sample, nothing once the data is live (the store clears it).
 */
// A live binding: the store clears it.
export let SAMPLE_NOTE = "Sample data: nothing was saved.";

export function setSampleNote(sample: boolean) {
  SAMPLE_NOTE = sample ? "Sample data: nothing was saved." : "";
}
