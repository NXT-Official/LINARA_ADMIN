import { useState } from "react";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FormDialog } from "@/components/shared/form";
import { PageHeader, Surface } from "@/components/shared/page";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeField } from "@/features/auth/components/code-field";
import { CURRENT_STAFF_ID } from "@/data/sample";
import { listStaff } from "@/data/queries";
import type { StaffMember } from "@/data/types";
import { formatDate, formatRelativeDay } from "@/lib/format";

/** FR-TM-2: invite by email, two-step code again, every admin told. */
function AddAdminDialog() {
  const [code, setCode] = useState("");
  return (
    <FormDialog
      trigger={
        <Button>
          <Plus />
          Add admin
        </Button>
      }
      title="Add an admin"
      description="They get an invite link that works for 24 hours, and no access until they set up two-step sign-in. Every admin gets an email about it."
      submitLabel="Send invite"
      done="Invite sent"
      canSubmit={code.length === 6}
    >
      {(id) => (
        <>
          <Field
            label="Work email"
            htmlFor={id("email")}
            hint="Use an email only for the console, not one they use for a Linara household."
          >
            <Input id={id("email")} type="email" required autoComplete="off" />
          </Field>
          <CodeField id={id("code")} value={code} onChange={setCode} />
        </>
      )}
    </FormDialog>
  );
}

/** FR-TM-3: not yourself, not the last admin; ends their sessions at once. */
function RemoveAdminDialog({ member }: { member: StaffMember }) {
  const [code, setCode] = useState("");
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline" className="relative z-10">
          Remove
        </Button>
      }
      title={`Remove ${member.fullName}`}
      description={`${member.fullName} is signed out everywhere at once and can't open the console again. Every admin gets an email about it.`}
      submitLabel="Remove admin"
      done="Admin removed"
      destructive
      canSubmit={code.length === 6}
    >
      {(id) => <CodeField id={id("code")} value={code} onChange={setCode} />}
    </FormDialog>
  );
}

export function TeamPage() {
  const staff = listStaff();
  const columns: Column<StaffMember>[] = [
    {
      key: "name",
      header: "Admin",
      mobile: "primary",
      cell: (s) => (
        <div className="min-w-0">
          <span className="font-semibold text-foreground">
            {s.fullName}
            {s.id === CURRENT_STAFF_ID ? (
              <span className="font-normal text-muted-foreground"> (you)</span>
            ) : null}
          </span>
          <div className="truncate text-xs text-muted-foreground">{s.email}</div>
        </div>
      ),
    },
    {
      key: "twostep",
      header: "Two-step sign-in",
      mobile: "primary",
      cell: (s) =>
        s.twoStepSetUp ? (
          <StatusChip tone="done">Set up</StatusChip>
        ) : (
          <StatusChip tone="attention">Not set up</StatusChip>
        ),
    },
    {
      key: "seen",
      header: "Last sign-in",
      cell: (s) => (s.lastSignInAt ? formatRelativeDay(s.lastSignInAt) : "Never"),
    },
    { key: "added", header: "Added", cell: (s) => formatDate(s.addedAt) },
    {
      key: "act",
      header: "",
      align: "right",
      mobile: "primary",
      cell: (s) =>
        s.id === CURRENT_STAFF_ID || staff.length === 1 ? null : <RemoveAdminDialog member={s} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Admins"
        description="People who can open the Business Console. Every admin can do everything here."
        actions={<AddAdminDialog />}
      />
      <Surface flush>
        <div className="pt-2">
          <DataTable
            label="Admins"
            rows={staff}
            columns={columns}
            rowKey={(s) => s.id}
            empty={null}
          />
        </div>
      </Surface>
      <p className="mt-3 px-1 text-xs text-muted-foreground">
        You can't remove yourself or the last admin.
      </p>
    </>
  );
}
