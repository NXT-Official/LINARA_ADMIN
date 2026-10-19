import { useState, type ReactNode } from "react";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, CHANNEL_LABEL, PRIORITY_LABEL } from "@/data/labels";

import { createTicketFn } from "../support.actions";
import type { TicketCategory, TicketChannel, TicketPriority } from "../support.types";

const opts = <K extends string>(labels: Record<K, string>) =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

/** In-app tickets start in the household's app, never from this form. */
const { in_app: _inApp, ...LOGGABLE_CHANNELS } = CHANNEL_LABEL;

/** What a ticket logged from a record's page is already linked to. */
export type TicketLinks = { userId?: string; householdId?: string; contactId?: string };

/** Logging a request that came in on another channel (FR-SP-1, FR-SP-2, D6). */
export function LogTicketDialog({
  trigger,
  links,
  onLogged,
}: {
  trigger: ReactNode;
  links?: TicketLinks;
  onLogged: (ticketId: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [channel, setChannel] = useState<TicketChannel>("messenger");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  return (
    <FormDialog
      trigger={trigger}
      title="Log a ticket"
      description="For a request that came in on Messenger, Viber, email or a call."
      submitLabel="Log ticket"
      done="Ticket logged"
      canSubmit={subject.trim().length > 0 && body.trim().length > 0}
      onSubmit={async () => {
        const res = await createTicketFn({
          data: {
            subject,
            body,
            channel,
            category,
            priority,
            ...(contact.trim() ? { contact } : {}),
            ...links,
          },
        });
        if (res.ok) {
          setSubject("");
          setBody("");
          setContact("");
          onLogged(res.ticketId);
        }
        return res;
      }}
    >
      {(id) => (
        <>
          <Field label="Subject" htmlFor={id("subject")}>
            <Input
              id={id("subject")}
              required
              autoComplete="off"
              maxLength={160}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label="What they need" htmlFor={id("body")}>
            <Textarea
              id={id("body")}
              rows={4}
              required
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Channel" htmlFor={id("channel")}>
              <SelectField
                id={id("channel")}
                value={channel}
                onChange={setChannel}
                options={opts(LOGGABLE_CHANNELS)}
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
            label="Who they are on that channel"
            htmlFor={id("handle")}
            hint={
              links
                ? "Linked to this record. More links can be added from the ticket page."
                : "Link the user, household or CRM contact from the ticket page once it's logged."
            }
          >
            <Input
              id={id("handle")}
              autoComplete="off"
              maxLength={120}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
