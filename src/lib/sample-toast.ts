import { toast } from "sonner";

/** Confirms an action while screens run on sample data. Names the action as the button did. */
export function sampleToast(done: string) {
  toast.success(done, { description: "Sample data: nothing was saved." });
}
