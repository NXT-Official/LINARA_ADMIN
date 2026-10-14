import { useState, type ReactNode } from "react";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";
import { ACTIVITY_LABEL, SOURCE_LABEL } from "@/data/labels";
import { listStaff } from "@/data/queries";
import type { ActivityKind, ContactSource } from "@/data/types";

const SOURCES = Object.entries(SOURCE_LABEL).map(([value, label]) => ({
  value: value as ContactSource,
  label,
}));
const KINDS = Object.entries(ACTIVITY_LABEL).map(([value, label]) => ({
  value: value as ActivityKind,
  label,
}));
const staffOptions = () => listStaff().map((s) => ({ value: s.id, label: s.fullName }));

/** For `<input type="datetime-local">`: now, in the browser's local time. */
function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function AddLeadDialog({ trigger }: { trigger: ReactNode }) {
  const [source, setSource] = useState<ContactSource | "">("");
  const [owner, setOwner] = useState("");
  return (
    <FormDialog
      trigger={trigger}
      title="Add a lead"
      description="Someone who hasn't signed up for Linara yet. Add an email or a phone number, or both."
      submitLabel="Add lead"
      done="Lead added"
    >
      {(id) => (
        <>
          <Field label="Name" htmlFor={id("name")}>
            <Input id={id("name")} required autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor={id("email")}>
              <Input id={id("email")} type="email" autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor={id("phone")} hint="Format 09XXXXXXXXX">
              <Input id={id("phone")} type="tel" inputMode="tel" autoComplete="off" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where they came from" htmlFor={id("source")}>
              <SelectField
                id={id("source")}
                value={source}
                onChange={setSource}
                options={SOURCES}
              />
            </Field>
            <Field label="Owner" htmlFor={id("owner")}>
              <SelectField
                id={id("owner")}
                value={owner}
                onChange={setOwner}
                options={staffOptions()}
              />
            </Field>
          </div>
          <Field label="Tags" htmlFor={id("tags")} hint="Separate with commas, e.g. OFW, Cebu">
            <Input id={id("tags")} autoComplete="off" />
          </Field>
          <Field label="Notes" htmlFor={id("notes")}>
            <Textarea id={id("notes")} rows={3} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Logging a call right after it happened: open, type, save (NFR-5). */
export function LogActivityDialog({ trigger, name }: { trigger: ReactNode; name: string }) {
  const [kind, setKind] = useState<ActivityKind>("call");
  return (
    <FormDialog
      trigger={trigger}
      title={`Log activity with ${name}`}
      submitLabel="Log activity"
      done="Activity logged"
    >
      {(id) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor={id("kind")}>
              <SelectField id={id("kind")} value={kind} onChange={setKind} options={KINDS} />
            </Field>
            <Field label="When it happened" htmlFor={id("at")}>
              <Input id={id("at")} type="datetime-local" defaultValue={localNow()} required />
            </Field>
          </div>
          <Field label="What was said" htmlFor={id("body")}>
            <Textarea id={id("body")} rows={4} required autoFocus />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function FollowUpDialog({ trigger, name }: { trigger: ReactNode; name: string }) {
  const [assignee, setAssignee] = useState("s-1");
  return (
    <FormDialog
      trigger={trigger}
      title={`Follow up with ${name}`}
      submitLabel="Add follow-up"
      done="Follow-up added"
    >
      {(id) => (
        <>
          <Field label="What to do" htmlFor={id("note")}>
            <Input id={id("note")} required autoComplete="off" autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due" htmlFor={id("due")}>
              <Input id={id("due")} type="date" required />
            </Field>
            <Field label="Who does it" htmlFor={id("assignee")}>
              <SelectField
                id={id("assignee")}
                value={assignee}
                onChange={setAssignee}
                options={staffOptions()}
              />
            </Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}

/** CSV import with a consent basis for the whole batch (FR-CRM-10, S-24). */
type MenuOpened = { open: boolean; onOpenChange: (open: boolean) => void };

export function ImportDialog({ open, onOpenChange }: MenuOpened) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import leads from a spreadsheet"
      description="Upload a CSV file. You'll match its columns and check for duplicates before anything is added. If any row fails, nothing is imported."
      submitLabel="Continue to column matching"
      done="File read"
    >
      {(id) => (
        <>
          <Field label="CSV file" htmlFor={id("file")}>
            <Input
              id={id("file")}
              type="file"
              accept=".csv,text/csv"
              required
              className="h-auto py-2"
            />
          </Field>
          <Field
            label="How these people agreed to be contacted"
            htmlFor={id("consent")}
            hint="Saved on every imported lead. Only import people who agreed to hear from Linara."
          >
            <Input
              id={id("consent")}
              required
              placeholder="e.g. Signed up for updates at the Makati home expo"
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Exports need the two-step code again and tell every admin (FR-CRM-11, S-18). */
export function ExportDialog({ open, onOpenChange, count }: MenuOpened & { count: number }) {
  const [code, setCode] = useState("");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export with contact details"
      description={`Downloads the ${count} contacts in the current list with their names, emails and phone numbers. Because it holds personal data, it needs your code, is recorded in the audit log, and every admin gets an email about it. For analysis, use Export CSV instead: it leaves contact details out.`}
      submitLabel="Export with contact details"
      done="Export ready"
      canSubmit={code.length === 6}
    >
      {(id) => <CodeField id={id("code")} value={code} onChange={setCode} />}
    </FormDialog>
  );
}
