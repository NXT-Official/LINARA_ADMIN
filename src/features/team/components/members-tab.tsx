import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FormDialog } from "@/components/shared/form";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeField } from "@/features/auth/components/code-field";
import type { RolePreset } from "@/features/auth/permissions";
import { formatDate, formatRelativeDay } from "@/lib/format";

import { setMemberRoleFn } from "../roles.actions";
import { assignableRoles, canChangeMember, needsCode, type RoleRow } from "../roles.types";
import { addAdminFn, removeAdminFn } from "../team.actions";
import type { AdminRow } from "../team.handlers.server";
import { TEAM_KEYS } from "../team-keys";
import { RolePicker } from "./role-picker";

function useRefreshTeam() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: TEAM_KEYS.members });
    await queryClient.invalidateQueries({ queryKey: TEAM_KEYS.roles });
    await queryClient.invalidateQueries({ queryKey: TEAM_KEYS.names });
  };
}

/** FR-TM-2: invite by email with a role; the code only for admin or mods. */
function AddMemberDialog({ roles }: { roles: RoleRow[] }) {
  const refresh = useRefreshTeam();
  const first = roles.find((r) => r.preset === "sales") ?? roles[0];
  const [email, setEmail] = useState("");
  // The roles can arrive after the dialog mounts: until one is picked, use the default.
  const [picked, setRoleId] = useState("");
  const roleId = picked || first?.roleId || "";
  const [code, setCode] = useState("");
  const codeNeeded = needsCode(roles.find((r) => r.roleId === roleId));
  return (
    <FormDialog
      trigger={
        <Button>
          <Plus />
          Add member
        </Button>
      }
      title="Add a team member"
      description="They get an invite link by email, and no access until they set up two-step sign-in. The change is recorded in the audit log."
      submitLabel="Send invite"
      done="Invite sent"
      canSubmit={email.includes("@") && !!roleId && (!codeNeeded || code.length === 6)}
      onSubmit={async () => {
        const res = await addAdminFn({
          data: { email, roleId, ...(codeNeeded ? { code } : {}) },
        });
        setCode("");
        if (res.ok) {
          setEmail("");
          await refresh();
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
          <Field label="Role" htmlFor={id("role")}>
            <RolePicker id={id("role")} roles={roles} value={roleId} onChange={setRoleId} />
          </Field>
          {codeNeeded ? <CodeField id={id("code")} value={code} onChange={setCode} /> : null}
        </>
      )}
    </FormDialog>
  );
}

/** FR-RL-6: the picker lists only roles the person changing it may give. */
function ChangeRoleDialog({ member, roles }: { member: AdminRow; roles: RoleRow[] }) {
  const refresh = useRefreshTeam();
  const [roleId, setRoleId] = useState(member.roleId);
  const [code, setCode] = useState("");
  const codeNeeded = needsCode(roles.find((r) => r.roleId === roleId));
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline" className="relative z-10">
          Change role
        </Button>
      }
      title={`Change ${member.email}'s role`}
      description="It applies on their next click. The change is recorded in the audit log."
      submitLabel="Change role"
      done="Role changed"
      canSubmit={roleId !== member.roleId && (!codeNeeded || code.length === 6)}
      onSubmit={async () => {
        const res = await setMemberRoleFn({
          data: { userId: member.userId, roleId, ...(codeNeeded ? { code } : {}) },
        });
        setCode("");
        if (res.ok) await refresh();
        return res;
      }}
    >
      {(id) => (
        <>
          <Field label="Role" htmlFor={id("role")}>
            <RolePicker id={id("role")} roles={roles} value={roleId} onChange={setRoleId} />
          </Field>
          {codeNeeded ? <CodeField id={id("code")} value={code} onChange={setCode} /> : null}
        </>
      )}
    </FormDialog>
  );
}

/** FR-TM-3: ends their sessions at once; needs the code. */
function RemoveMemberDialog({ member }: { member: AdminRow }) {
  const refresh = useRefreshTeam();
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
      submitLabel="Remove member"
      done="Member removed"
      destructive
      canSubmit={code.length === 6}
      onSubmit={async () => {
        const res = await removeAdminFn({ data: { userId: member.userId, code } });
        setCode("");
        if (res.ok) await refresh();
        return res;
      }}
    >
      {(id) => <CodeField id={id("code")} value={code} onChange={setCode} />}
    </FormDialog>
  );
}

export function MembersTab({
  members,
  roles,
  actor,
  loading,
}: {
  members: AdminRow[];
  roles: RoleRow[];
  actor: { userId: string; preset: RolePreset | null };
  loading: boolean;
}) {
  const giveable = assignableRoles(actor.preset, roles);
  const columns: Column<AdminRow>[] = [
    {
      key: "email",
      header: "Member",
      mobile: "primary",
      cell: (a) => (
        <span className="min-w-0 truncate font-semibold text-foreground">
          {a.email}
          {a.isYou ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
        </span>
      ),
    },
    { key: "role", header: "Role", mobile: "primary", cell: (a) => a.roleName },
    {
      key: "twostep",
      header: "Two-step sign-in",
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
    { key: "added", header: "Added", mobile: "hidden", cell: (a) => formatDate(a.addedAt) },
    {
      key: "act",
      header: "",
      align: "right",
      mobile: "primary",
      cell: (a) => {
        const verdict = canChangeMember(actor, { userId: a.userId, preset: a.preset });
        if (!verdict.ok)
          return <span className="text-xs text-muted-foreground">{verdict.why}</span>;
        return (
          <span className="inline-flex flex-wrap justify-end gap-2">
            <ChangeRoleDialog member={a} roles={giveable} />
            <RemoveMemberDialog member={a} />
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className="flex justify-end px-5 pb-3 sm:px-6">
        <AddMemberDialog roles={giveable} />
      </div>
      <DataTable
        label="Team members"
        rows={members}
        columns={columns}
        rowKey={(a) => a.userId}
        empty={<EmptyState title={loading ? "Loading the team" : "No members found"} />}
      />
    </>
  );
}
