import { toast } from "sonner";

let sample = true;

/** The billing screens' data is live (D48): their confirmations stop saying "sample". */
export function setSampleToasts(on: boolean) {
  sample = on;
}

/** Confirms an action while screens run on sample data. Names the action as the button did. */
export function sampleToast(done: string) {
  toast.success(done, sample ? { description: "Sample data: nothing was saved." } : undefined);
}
