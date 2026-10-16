import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Field, FormDialog } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";
import { PERMISSION_GROUPS, PERMISSION_LABEL, type Permission } from "@/features/auth/permissions";

import { createRoleFn, deleteRoleFn, updateRoleFn } from "../roles.actions";
import type { RoleRow } from "../roles.types";
import { TEAM_KEYS } from "../team-keys";

/** What the editor starts from: a new role (maybe a preset's copy) or a custom role. */
export type RoleDraft =
  { mode: "new"; name: string; permissions: Permission[] } | { mode: "edit"; role: RoleRow };

const sorted = (list: Iterable<string>) => [...new Set(list)].sort() as Permission[];
const same = (a: string[], b: string[]) => a.join() === b.join();

function membersLine(n: number) {
  return n === 1 ? "1 member has this role." : `${n} members have this role.`;
}

/**
 * FR-RL-3 to FR-RL-5: name, description and permissions as checkboxes. The
 * dashboard is always on (D39) and "Manage team and roles" is never offered.
 * Saving changed permissions asks for the two-step code.
 */
export function RoleEditorDialog({ draft, onClose }: { draft: RoleDraft; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = draft.mode === "edit" ? draft.role : null;
  const start = sorted(
    (editing ? editing.permissions : draft.mode === "new" ? draft.permissions : [])
      .filter((p) => p !== "team.manage")
      .concat("dashboard.view"),
  );
  const [name, setName] = useState(editing ? editing.name : draft.mode === "new" ? draft.name : "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(start);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  // A new role is new access; an edit needs the code only when permissions change (spec 0.19).
  const codeNeeded = !editing || !same(permissions, sorted(editing.permissions));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: TEAM_KEYS.roles });
    await queryClient.invalidateQueries({ queryKey: TEAM_KEYS.members });
  };
  const toggle = (p: Permission, on: boolean) =>
    setPermissions((list) => sorted(on ? [...list, p] : list.filter((x) => x !== p)));

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? editing.name : "New role"}
      description={
        editing
          ? "Changes apply on each member's next click and are recorded in the audit log."
          : "Pick what the role can see and do. Only admins and mods can give it."
      }
      submitLabel={editing ? "Save role" : "Create role"}
      done={editing ? "Role saved" : "Role created"}
      canSubmit={name.trim().length > 0 && (!codeNeeded || code.length === 6)}
      onSubmit={async () => {
        const data = { name, description, permissions };
        const res = editing
          ? await updateRoleFn({
              data: {
                roleId: editing.roleId,
                ...data,
                seenUpdatedAt: editing.updatedAt,
                ...(codeNeeded ? { code } : {}),
              },
            })
          : await createRoleFn({ data: { ...data, code } });
        setCode("");
        if (res.ok) await refresh();
        return res;
      }}
    >
      {(id) => (
        <>
          <Field label="Name" htmlFor={id("name")}>
            <Input
              id={id("name")}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor={id("description")} hint="Optional">
            <Textarea
              id={id("description")}
              rows={2}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {PERMISSION_GROUPS.map((group) => (
            <fieldset key={group.label} className="space-y-2">
              <legend className="text-xs font-semibold text-muted-foreground">{group.label}</legend>
              {group.permissions.map((p) => (
                <label key={p} className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--pine)]"
                    checked={permissions.includes(p)}
                    disabled={p === "dashboard.view"}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                  <span>{PERMISSION_LABEL[p]}</span>
                </label>
              ))}
            </fieldset>
          ))}
          {codeNeeded ? <CodeField id={id("code")} value={code} onChange={setCode} /> : null}
          {editing ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">
                {editing.memberCount > 0
                  ? membersLine(editing.memberCount)
                  : "No one has this role."}
              </span>
              {confirming ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={editing.memberCount > 0}
                  onClick={() => setConfirming(true)}
                >
                  Delete role
                </Button>
              )}
            </div>
          ) : null}
          {editing && confirming ? (
            // FR-RL-5: a second, explicit step before the role is gone.
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-status-late-soft px-3 py-2"
            >
              <span className="text-sm text-status-late-ink">
                Delete this role? This can't be undone.
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    const res = await deleteRoleFn({ data: { roleId: editing.roleId } });
                    if (!res.ok) {
                      setConfirming(false);
                      toast.error(res.message);
                      return;
                    }
                    toast.success("Role deleted");
                    await refresh();
                    onClose();
                  }}
                >
                  Yes, delete
                </Button>
              </span>
            </div>
          ) : null}
        </>
      )}
    </FormDialog>
  );
}
