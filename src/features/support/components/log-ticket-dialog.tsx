import { useState, type ReactNode } from "react";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, CHANNEL_LABEL, PRIORITY_LABEL } from "@/data/labels";
import type { TicketCategory, TicketChannel, TicketPriority } from "@/data/types";

const opts = <V extends string>(labels: Record<V, string>) =>
  (Object.entries(labels) as [V, string][]).map(([value, label]) => ({ value, label }));

/** A conversation from Messenger, Viber, email or a call, logged by an admin (FR-SP-1, D6). */
export function LogTicketDialog({ trigger }: { trigger: ReactNode }) {
  const [channel, setChannel] = useState<TicketChannel | "">("");
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  return (
    <FormDialog
      trigger={trigger}
      title="Log a ticket"
      description="For a request that came in on Messenger, Viber, email or a call."
      submitLabel="Log ticket"
      done="Ticket logged"
      canSubmit={!!channel && !!category}
    >
      {(id) => (
        <>
          <Field label="Subject" htmlFor={id("subject")}>
            <Input id={id("subject")} required autoComplete="off" />
          </Field>
          <Field label="What they need" htmlFor={id("body")}>
            <Textarea id={id("body")} rows={4} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Channel" htmlFor={id("channel")}>
              <SelectField
                id={id("channel")}
                value={channel}
                onChange={setChannel}
                options={opts(CHANNEL_LABEL)}
              />
            </Field>
            <Field label="Category" htmlFor={id("category")}>
              <SelectField
                id={id("category")}
                value={category}
                onChange={setCategory}
                options={opts(CATEGORY_LABEL)}
              />
            </Field>
            <Field label="Priority" htmlFor={id("priority")}>
              <SelectField
                id={id("priority")}
                value={priority}
                onChange={setPriority}
                options={opts(PRIORITY_LABEL)}
              />
            </Field>
          </div>
          <Field
            label="Their name or handle on that channel"
            htmlFor={id("handle")}
            hint="Link the user, household or CRM contact from the ticket page once it's logged."
          >
            <Input id={id("handle")} autoComplete="off" />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
