import { useState, type ReactNode } from "react";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";
import { ACTIVITY_LABEL, SOURCE_LABEL } from "@/data/labels";
import type { ActivityKind, ContactSource } from "@/data/types";
import { useAdmins } from "@/features/team/use-admins";

import { csvFilename, downloadCsv, toCsv } from "@/lib/csv";

import {
  addActivityFn,
  addFollowUpFn,
  createLeadFn,
  exportContactsFn,
  setLeadStageFn,
  updateContactFn,
} from "../crm.actions";
import { CONTACT_DETAILS_CSV } from "../crm.export";
import type { ContactFilters } from "../crm.handlers.server";
import type { ContactDetail, ContactRef } from "../crm.types";
import { contactRef } from "../crm.utils";

const SOURCE_OPTIONS = Object.entries(SOURCE_LABEL).map(([value, label]) => ({
  value: value as ContactSource,
  label,
}));
const KINDS = Object.entries(ACTIVITY_LABEL).map(([value, label]) => ({
  value: value as ActivityKind,
  label,
}));

/** For `<input type="datetime-local">`: now, in the browser's local time. */
function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function AddLeadDialog({
  trigger,
  onAdded,
}: {
  trigger: ReactNode;
  onAdded?: (contactId: string) => void;
}) {
  const admins = useAdmins();
  const empty = { fullName: "", email: "", phone: "", tags: "", note: "" };
  const [form, setForm] = useState(empty);
  const [source, setSource] = useState<ContactSource | "">("");
  const [owner, setOwner] = useState("");
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <FormDialog
      trigger={trigger}
      title="Add a lead"
      description="Someone who hasn't signed up for Linara yet. Add an email or a phone number, or both."
      submitLabel="Add lead"
      done="Lead added"
      onSubmit={async () => {
        const res = await createLeadFn({
          data: { ...form, source: source || null, ownerId: owner || null },
        });
        if (res.ok) {
          setForm(empty);
          setSource("");
          setOwner("");
          onAdded?.(res.contactId);
        }
        return res;
      }}
    >
      {(id) => (
        <>
          <Field label="Name" htmlFor={id("name")}>
            <Input
              id={id("name")}
              required
              autoComplete="off"
              value={form.fullName}
              onChange={set("fullName")}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor={id("email")}>
              <Input
                id={id("email")}
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={set("email")}
              />
            </Field>
            <Field label="Phone" htmlFor={id("phone")} hint="Format 09XXXXXXXXX">
              <Input
                id={id("phone")}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={form.phone}
                onChange={set("phone")}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where they came from" htmlFor={id("source")}>
              <SelectField
                id={id("source")}
                value={source}
                onChange={setSource}
                options={SOURCE_OPTIONS}
              />
            </Field>
            <Field label="Owner" htmlFor={id("owner")}>
              <SelectField
                id={id("owner")}
                value={owner}
                onChange={setOwner}
                options={admins.options}
              />
            </Field>
          </div>
          <Field label="Tags" htmlFor={id("tags")} hint="Separate with commas, e.g. OFW, Cebu">
            <Input id={id("tags")} autoComplete="off" value={form.tags} onChange={set("tags")} />
          </Field>
          <Field label="Notes" htmlFor={id("notes")}>
            <Textarea id={id("notes")} rows={3} value={form.note} onChange={set("note")} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Logging a call right after it happened: open, type, save (NFR-5). */
export function LogActivityDialog({
  trigger,
  name,
  contactRef: target,
  onSaved,
}: {
  trigger: ReactNode;
  name: string;
  contactRef: ContactRef;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<ActivityKind>("call");
  const [at, setAt] = useState(localNow);
  const [body, setBody] = useState("");
  return (
    <FormDialog
      trigger={trigger}
      title={`Log activity with ${name}`}
      submitLabel="Log activity"
      done="Activity logged"
      canSubmit={body.trim().length > 0}
      // "Now" is when the dialog opens: the page may have been open for hours.
      onOpenChange={(open) => open && setAt(localNow())}
      onSubmit={async () => {
        const res = await addActivityFn({
          data: { ref: target, kind, body, occurredAt: new Date(at).toISOString() },
        });
        if (res.ok) {
          setBody("");
          setAt(localNow());
          onSaved();
        }
        return res;
      }}
    >
      {(id) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor={id("kind")}>
              <SelectField id={id("kind")} value={kind} onChange={setKind} options={KINDS} />
            </Field>
            <Field label="When it happened" htmlFor={id("at")}>
              <Input
                id={id("at")}
                type="datetime-local"
                value={at}
                max={localNow()}
                onChange={(e) => setAt(e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="What was said" htmlFor={id("body")}>
            <Textarea
              id={id("body")}
              rows={4}
              required
              autoFocus
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function FollowUpDialog({
  trigger,
  name,
  contactRef: target,
  onSaved,
}: {
  trigger: ReactNode;
  name: string;
  contactRef: ContactRef;
  onSaved: () => void;
}) {
  const admins = useAdmins();
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const who = assignee || admins.me || "";
  return (
    <FormDialog
      trigger={trigger}
      title={`Follow up with ${name}`}
      submitLabel="Add follow-up"
      done="Follow-up added"
      canSubmit={note.trim().length > 0 && !!due && !!who}
      onSubmit={async () => {
        // A due date is a Manila day; 9 in the morning keeps it on that day everywhere.
        const res = await addFollowUpFn({
          data: { ref: target, note, dueAt: `${due}T09:00:00+08:00`, assigneeId: who },
        });
        if (res.ok) {
          setNote("");
          setDue("");
          onSaved();
        }
        return res;
      }}
    >
      {(id) => (
        <>
          <Field label="What to do" htmlFor={id("note")}>
            <Input
              id={id("note")}
              required
              autoComplete="off"
              autoFocus
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due" htmlFor={id("due")}>
              <Input
                id={id("due")}
                type="date"
                required
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
            <Field label="Who does it" htmlFor={id("assignee")}>
              <SelectField
                id={id("assignee")}
                value={who}
                onChange={setAssignee}
                options={admins.options}
              />
            </Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}

/** Marking a lead lost needs a reason (FR-CRM-5). */
export function MarkLostDialog({
  open,
  onOpenChange,
  contactId,
  onSaved,
}: MenuOpened & { contactId: string; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark as lost"
      description="Say why, so the team can learn from it. The lead stays in the CRM."
      submitLabel="Mark as lost"
      done="Marked as lost"
      canSubmit={reason.trim().length > 0}
      onSubmit={async () => {
        const res = await setLeadStageFn({
          data: { contactId, stage: "lost", lostReason: reason },
        });
        if (res.ok) {
          setReason("");
          onSaved();
        }
        return res;
      }}
    >
      {(id) => (
        <Field label="Why" htmlFor={id("reason")}>
          <Input
            id={id("reason")}
            required
            autoFocus
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
    </FormDialog>
  );
}

/**
 * A lead's details, or a customer's owner and tags: a customer's name and
 * email come from their Linara account (FR-CRM-3).
 */
export function EditContactDialog({
  trigger,
  contact,
  onSaved,
}: {
  trigger: ReactNode;
  contact: ContactDetail;
  onSaved: (contactId: string) => void;
}) {
  const admins = useAdmins();
  const isLead = contact.kind === "lead";
  const [form, setForm] = useState({
    fullName: contact.fullName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    tags: contact.tags.join(", "),
  });
  const [source, setSource] = useState<ContactSource | "">(contact.source ?? "");
  const [owner, setOwner] = useState(contact.ownerId ?? "");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const ref = contactRef(contact);

  return (
    <FormDialog
      trigger={trigger}
      title={isLead ? "Edit details" : "Edit owner and tags"}
      submitLabel="Save"
      done="Saved"
      onSubmit={async () => {
        const res = await updateContactFn({
          data: isLead
            ? {
                ref,
                details: {
                  fullName: form.fullName,
                  email: form.email,
                  phone: form.phone,
                  source: source || null,
                  ownerId: owner || null,
                  tags: form.tags,
                },
              }
            : { ref, ownerId: owner || null, tags: form.tags },
        });
        if (res.ok) onSaved(res.contactId);
        return res;
      }}
    >
      {(id) => (
        <>
          {isLead ? (
            <>
              <Field label="Name" htmlFor={id("name")}>
                <Input id={id("name")} required value={form.fullName} onChange={set("fullName")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" htmlFor={id("email")}>
                  <Input id={id("email")} type="email" value={form.email} onChange={set("email")} />
                </Field>
                <Field label="Phone" htmlFor={id("phone")} hint="Format 09XXXXXXXXX">
                  <Input
                    id={id("phone")}
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={set("phone")}
                  />
                </Field>
              </div>
              <Field label="Where they came from" htmlFor={id("source")}>
                <SelectField
                  id={id("source")}
                  value={source}
                  onChange={setSource}
                  options={SOURCE_OPTIONS}
                />
              </Field>
            </>
          ) : null}
          <Field label="Owner" htmlFor={id("owner")}>
            <SelectField
              id={id("owner")}
              value={owner}
              onChange={setOwner}
              options={admins.options}
            />
          </Field>
          <Field label="Tags" htmlFor={id("tags")} hint="Separate with commas, e.g. OFW, Cebu">
            <Input id={id("tags")} autoComplete="off" value={form.tags} onChange={set("tags")} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** A yes-or-no question before something that can't be undone from here. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  done,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  done: string;
  onConfirm: () => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={title}
      description={description}
      submitLabel={confirmLabel}
      done={done}
      destructive
      onSubmit={onConfirm}
    >
      {null}
    </FormDialog>
  );
}

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

/**
 * The export with contact details (FR-CRM-11, S-5, S-18): the two-step code
 * again, recorded in the audit log, at most 5,000 rows.
 */
export function ExportDialog({
  open,
  onOpenChange,
  filters,
}: MenuOpened & { filters: ContactFilters }) {
  const [code, setCode] = useState("");
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setCode("");
        onOpenChange(o);
      }}
      title="Export with contact details"
      description="Downloads the contacts that match the current filters with their names, emails and phone numbers. Because it holds personal data, it needs your code and is recorded in the audit log. For analysis, use Export CSV instead: it leaves contact details out."
      submitLabel="Export with contact details"
      done="Export downloaded"
      canSubmit={code.length === 6}
      onSubmit={async () => {
        const res = await exportContactsFn({ data: { filters, code } });
        if (!res.ok) {
          setCode("");
          return res;
        }
        downloadCsv(csvFilename("crm-contacts-with-details"), toCsv(CONTACT_DETAILS_CSV, res.rows));
        setCode("");
        return res;
      }}
    >
      {(id) => <CodeField id={id("code")} value={code} onChange={setCode} />}
    </FormDialog>
  );
}
