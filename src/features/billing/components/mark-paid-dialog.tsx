import { useState, type ReactNode } from "react";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";
import { fmtCentavos } from "@/lib/money";

import { markInvoicePaidFn } from "../billing.actions";
import { INVOICE_CHANNELS, type InvoiceChannel } from "../billing.types";

const CHANNEL_LABEL: Record<InvoiceChannel, string> = {
  bank_transfer: "Bank transfer",
  gcash: "GCash",
  maya: "Maya",
  cash: "Cash",
  other: "Other",
};

export const ALREADY_SETTLED = "That invoice was already paid or expired, so nothing changed.";

/**
 * A payment that arrived outside Xendit. Needs the reason and the two-step code
 * again (S-5). If the invoice was settled meanwhile it says so rather than
 * claiming a change.
 */
export function MarkPaidDialog({
  trigger,
  invoice,
  onDone,
}: {
  trigger: ReactNode;
  invoice: { id: string; invoiceNumber: string; amountCentavos: number };
  onDone: () => void;
}) {
  const [channel, setChannel] = useState<InvoiceChannel | "">("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");

  return (
    <FormDialog
      trigger={trigger}
      title={`Mark ${invoice.invoiceNumber} paid`}
      description={`${fmtCentavos(invoice.amountCentavos)} received outside Xendit. This starts the plan the way a Xendit payment would.`}
      submitLabel="Mark paid"
      done="Marked paid"
      canSubmit={channel !== "" && reason.trim().length >= 1 && code.length === 6}
      onOpenChange={(open) => {
        if (!open) {
          setChannel("");
          setNote("");
          setReason("");
          setCode("");
        }
      }}
      onSubmit={async () => {
        if (channel === "") return { ok: false, message: "Pick how the payment arrived." };
        const res = await markInvoicePaidFn({
          data: { invoiceId: invoice.id, channel, note, reason, code },
        });
        setCode("");
        if (!res.ok) return res;
        onDone();
        return res.applied ? { ok: true } : { ok: true, done: ALREADY_SETTLED };
      }}
    >
      {(id) => (
        <>
          <Field label="How it was paid" htmlFor={id("channel")}>
            <SelectField
              id={id("channel")}
              value={channel}
              onChange={setChannel}
              options={INVOICE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
              placeholder="Choose a channel"
            />
          </Field>
          <Field label="Note" htmlFor={id("note")} hint="Optional, up to 500 characters.">
            <Textarea
              id={id("note")}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Field
            label="Reason"
            htmlFor={id("reason")}
            hint="Up to 200 characters. Saved in the audit log."
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
