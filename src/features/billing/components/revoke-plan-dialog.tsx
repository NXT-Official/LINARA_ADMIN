import { useState, type ReactNode } from "react";

import { Field, FormDialog } from "@/components/shared/form";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";

import { revokeSubscriptionFn } from "../billing.actions";

/**
 * Ends a household's plan for good (billing_revoke): canceled now, no renewal,
 * and a payment for it that arrives later is noted for a refund. Needs the
 * reason and the two-step code again (S-5); the audit log keeps the reason,
 * never an amount (S-22).
 */
export function RevokePlanDialog({
  trigger,
  subscription,
  onDone,
}: {
  trigger: ReactNode;
  subscription: { id: string; planName: string };
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");

  return (
    <FormDialog
      trigger={trigger}
      title={`Revoke ${subscription.planName}`}
      description="Ends this plan now, for good. The household drops to the free tier, can't renew it, and a payment for it that arrives later is noted for a refund. A new plan for the household still works."
      submitLabel="Revoke plan"
      done="Plan revoked"
      destructive
      canSubmit={reason.trim().length >= 1 && code.length === 6}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          setCode("");
        }
      }}
      onSubmit={async () => {
        const res = await revokeSubscriptionFn({
          data: { subscriptionId: subscription.id, reason, code },
        });
        setCode("");
        if (res.ok) onDone();
        return res;
      }}
    >
      {(id) => (
        <>
          <Field
            label="Reason"
            htmlFor={id("reason")}
            hint="Up to 200 characters. Saved in the audit log and on the plan's notes."
          >
            <Textarea
              id={id("reason")}
              rows={2}
              required
              maxLength={200}
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
