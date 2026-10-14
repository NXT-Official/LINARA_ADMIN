import { useState, type ReactNode } from "react";

import { Field, FormDialog } from "@/components/shared/form";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";

/** Suspend and unsuspend need a reason and the two-step code again (FR-US-4, S-5). */
export function SuspendDialog({
  trigger,
  name,
  suspended,
}: {
  trigger: ReactNode;
  name: string;
  suspended: boolean;
}) {
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      trigger={trigger}
      title={suspended ? `Unsuspend ${name}` : `Suspend ${name}`}
      description={
        suspended
          ? `${name} will be able to sign in again.`
          : // FR-US-5: what suspending does, and what it can't do.
            `${name} won't be able to sign in again. If they're signed in now, that session keeps working until it expires, up to about an hour.`
      }
      submitLabel={suspended ? "Unsuspend" : "Suspend"}
      done={suspended ? "User unsuspended" : "User suspended"}
      destructive={!suspended}
      canSubmit={code.length === 6 && reason.trim().length > 0}
    >
      {(id) => (
        <>
          <Field label="Reason" htmlFor={id("reason")} hint="Saved in the audit log.">
            <Textarea
              id={id("reason")}
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <CodeField id={id("code")} value={code} onChange={setCode} />
        </>
      )}
    </FormDialog>
  );
}
