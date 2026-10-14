import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FormDialog } from "@/components/shared/form";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeField } from "@/features/auth/components/code-field";
import { formatDate, formatRelativeDay } from "@/lib/format";

import { addAdminFn, listAdminsFn, removeAdminFn } from "../team.actions";
import type { AdminRow } from "../team.handlers.server";

const ADMINS = ["admins"] as const;

/** FR-TM-2: invite by email, with the two-step code again. */
function AddAdminDialog() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
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
      description="They get an invite link by email, and no access until they set up two-step sign-in. The change is recorded in the audit log."
      submitLabel="Send invite"
      done="Invite sent"
      canSubmit={code.length === 6 && email.includes("@")}
      onSubmit={async () => {
        const res = await addAdminFn({ data: { email, code } });
        setCode("");
        if (res.ok) {
          setEmail("");
          await queryClient.invalidateQueries({ queryKey: ADMINS });
        }
        return res;
      }}
    >
      {(id) => (
        <>
          <Field
            label="Work email"
            htmlFor={id("email")}
            hint="Use an email only for the console, not one they use for a Linara household."
          >
            <Input
              id={id("email")}
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <CodeField id={id("code")} value={code} onChange={setCode} />
        </>
      )}
    </FormDialog>
  );
}

/** FR-TM-3: not yourself, not the last admin; ends their sessions at once. */
function RemoveAdminDialog({ member }: { member: AdminRow }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline" className="relative z-10">
          Remove
        </Button>
      }
      title={`Remove ${member.email}`}
      description="They're signed out everywhere at once and can't open the console again. The change is recorded in the audit log."
      submitLabel="Remove admin"
      done="Admin removed"
      destructive
      canSubmit={code.length === 6}
      onSubmit={async () => {
        const res = await removeAdminFn({ data: { userId: member.userId, code } });
        setCode("");
        if (res.ok) await queryClient.invalidateQueries({ queryKey: ADMINS });
        return res;
      }}
    >
      {(id) => <CodeField id={id("code")} value={code} onChange={setCode} />}
    </FormDialog>
  );
}

export function TeamPage() {
  const { data, isPending } = useQuery({ queryKey: ADMINS, queryFn: () => listAdminsFn() });
  const admins = data?.ok ? data.admins : [];

  const columns: Column<AdminRow>[] = [
    {
      key: "email",
      header: "Admin",
      mobile: "primary",
      cell: (a) => (
        <span className="min-w-0 truncate font-semibold text-foreground">
          {a.email}
          {a.isYou ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
        </span>
      ),
    },
    {
      key: "twostep",
      header: "Two-step sign-in",
      mobile: "primary",
      cell: (a) =>
        a.twoStepSetUp ? (
          <StatusChip tone="done">Set up</StatusChip>
        ) : (
          <StatusChip tone="attention">Not set up</StatusChip>
        ),
    },
    {
      key: "seen",
      header: "Last sign-in",
      cell: (a) => (a.lastSignInAt ? formatRelativeDay(a.lastSignInAt) : "Never"),
    },
    { key: "added", header: "Added", cell: (a) => formatDate(a.addedAt) },
    {
      key: "act",
      header: "",
      align: "right",
      mobile: "primary",
      cell: (a) => (a.isYou || admins.length === 1 ? null : <RemoveAdminDialog member={a} />),
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
          {data && !data.ok ? (
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState title="The admin list didn't load">{data.message}</EmptyState>
            </div>
          ) : (
            <DataTable
              label="Admins"
              rows={admins}
              columns={columns}
              rowKey={(a) => a.userId}
              empty={<EmptyState title={isPending ? "Loading admins" : "No admins found"} />}
            />
          )}
        </div>
      </Surface>
      <p className="mt-3 px-1 text-xs text-muted-foreground">
        You can't remove yourself or the last admin. Invite links work for an hour; if one runs out,
        the new admin can use Forgot your password? on the sign-in page to get a fresh link.
      </p>
    </>
  );
}
