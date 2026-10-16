import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { SegmentedFilter } from "@/components/shared/list-toolbar";
import { PageHeader, Surface } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { useStaff } from "@/features/auth/use-can";

import { MembersTab } from "../components/members-tab";
import { RolesTab } from "../components/roles-tab";
import { listRolesFn } from "../roles.actions";
import { listAdminsFn } from "../team.actions";
import { TEAM_KEYS } from "../team-keys";

export type TeamTab = "members" | "roles";

/** The Team screen: members and their roles, and the roles themselves (FR-TM-1, FR-RL-1). */
export function TeamPage({ tab: initialTab = "members" }: { tab?: TeamTab }) {
  const staff = useStaff();
  const [tab, setTab] = useState<TeamTab>(initialTab);
  const members = useQuery({ queryKey: TEAM_KEYS.members, queryFn: () => listAdminsFn() });
  const roles = useQuery({ queryKey: TEAM_KEYS.roles, queryFn: () => listRolesFn() });
  const failed =
    (members.data && !members.data.ok && members.data.message) ||
    (roles.data && !roles.data.ok && roles.data.message);

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can open the Business Console, and what each role lets them see and do."
      />
      <Surface flush>
        <div className="space-y-3 pt-5">
          <div className="px-5 sm:px-6">
            <SegmentedFilter
              label="Team view"
              value={tab}
              onChange={setTab}
              options={[
                { value: "members", label: "Members" },
                { value: "roles", label: "Roles" },
              ]}
            />
          </div>
          {failed ? (
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState title="The team didn't load">{failed}</EmptyState>
            </div>
          ) : tab === "members" ? (
            <MembersTab
              members={members.data?.ok ? members.data.admins : []}
              roles={roles.data?.ok ? roles.data.roles : []}
              actor={{ userId: staff?.userId ?? "", preset: staff?.preset ?? null }}
              loading={members.isPending}
            />
          ) : (
            <RolesTab roles={roles.data?.ok ? roles.data.roles : []} loading={roles.isPending} />
          )}
        </div>
      </Surface>
      <p className="mt-3 px-1 text-xs text-muted-foreground">
        Nobody can change their own role or remove themselves, and there is always at least one
        admin. Invite links work for an hour; if one runs out, the new member can use Forgot your
        password? on the sign-in page to get a fresh link.
      </p>
    </>
  );
}
