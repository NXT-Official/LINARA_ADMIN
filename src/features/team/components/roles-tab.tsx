import { useState } from "react";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState, TableSkeleton } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PERMISSION_GROUPS, PERMISSION_LABEL } from "@/features/auth/permissions";

import type { RoleRow } from "../roles.types";
import { RoleEditorDialog, type RoleDraft } from "./role-editor-dialog";

/** FR-RL-2: a preset is read-only; Duplicate starts a custom role from it. */
function PresetDialog({
  role,
  onClose,
  onDuplicate,
}: {
  role: RoleRow;
  onClose: () => void;
  onDuplicate: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl font-normal">{role.name}</DialogTitle>
          <DialogDescription>
            A preset role. It can't be changed; duplicate it to make a custom role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {PERMISSION_GROUPS.map((group) => {
            const held = group.permissions.filter((p) => role.permissions.includes(p));
            if (held.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
                  {held.map((p) => (
                    <li key={p}>{PERMISSION_LABEL[p]}</li>
                  ))}
                </ul>
              </div>
            );
          })}
          {role.permissions.includes("team.manage") ? (
            <p className="text-sm text-foreground">
              {role.preset === "mods"
                ? "Manages the team, giving only sales, support and custom roles."
                : "Manages the team and every role."}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onDuplicate}>
            Duplicate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RolesTab({ roles, loading }: { roles: RoleRow[]; loading: boolean }) {
  const [preset, setPreset] = useState<RoleRow | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  // Bumped per opening, so the editor starts fresh every time.
  const [opened, setOpened] = useState(0);
  const edit = (next: RoleDraft) => {
    setOpened((n) => n + 1);
    setDraft(next);
  };

  const columns: Column<RoleRow>[] = [
    {
      key: "name",
      header: "Role",
      mobile: "primary",
      cell: (r) => (
        <button
          type="button"
          aria-label={`Open ${r.name}`}
          className="relative z-10 cursor-pointer text-left font-semibold text-pine underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => (r.preset ? setPreset(r) : edit({ mode: "edit", role: r }))}
        >
          {r.name}
        </button>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      mobile: "primary",
      cell: (r) =>
        r.preset ? (
          <StatusChip tone="quiet">Preset</StatusChip>
        ) : (
          <StatusChip tone="done">Custom</StatusChip>
        ),
    },
    {
      key: "permissions",
      header: "Permissions",
      cell: (r) =>
        r.permissions.length === 1 ? "1 permission" : `${r.permissions.length} permissions`,
    },
    {
      key: "members",
      header: "Members",
      cell: (r) => <span className="tabular-nums">{r.memberCount}</span>,
    },
  ];

  return (
    <>
      <div className="flex justify-end px-5 pb-3 sm:px-6">
        <Button onClick={() => edit({ mode: "new", name: "", permissions: ["dashboard.view"] })}>
          <Plus />
          New role
        </Button>
      </div>
      <DataTable
        label="Roles"
        rows={roles}
        columns={columns}
        rowKey={(r) => r.roleId}
        empty={
          loading ? (
            <TableSkeleton label="Loading roles" rows={4} />
          ) : (
            <EmptyState title="No roles found" />
          )
        }
      />
      {preset ? (
        <PresetDialog
          role={preset}
          onClose={() => setPreset(null)}
          onDuplicate={() => {
            setPreset(null);
            edit({ mode: "new", name: `${preset.name} copy`, permissions: preset.permissions });
          }}
        />
      ) : null}
      {draft ? (
        <RoleEditorDialog key={opened} draft={draft} onClose={() => setDraft(null)} />
      ) : null}
    </>
  );
}
