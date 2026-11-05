import { writeAudit } from "@/features/audit/audit.server";
import { checkRateLimit } from "@/features/auth/rate-limit.server";
import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import {
  PERMISSION_LABEL,
  PERMISSIONS,
  type Permission,
  type RolePreset,
} from "@/features/auth/permissions";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { APP_ENV_LABEL } from "@/lib/env";
import { isUuid } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { serverEnv } from "@/lib/server-env.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { assignableRoles, needsCode, type RoleRow } from "./roles.types";
import { notifyMemberAdded, notifyMemberRemoved, notifyTwoStepReset } from "./team-notify.server";

/** The Team screen's members (FR-TM-1 to FR-TM-3, D28, D31, D39). */

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("team", e);
    return toPublicError(e);
  }
}

export type AdminRow = {
  userId: string;
  email: string;
  addedAt: string;
  lastSignInAt: string | null;
  twoStepSetUp: boolean;
  isYou: boolean;
  roleId: string;
  roleName: string;
  preset: RolePreset | null;
};

export function listAdminsHandler(): Promise<{ ok: true; admins: AdminRow[] } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    // One query for every member, instead of one Auth call each (D31).
    const { data, error } = await getAdminClient().rpc("staff_list_admins");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      user_id: string;
      email: string;
      granted_at: string;
      last_sign_in_at: string | null;
      two_step_set_up: boolean;
      role_id: string;
      role_name: string;
      preset: RolePreset | null;
    }[];
    return {
      ok: true as const,
      admins: rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        addedAt: r.granted_at,
        lastSignInAt: r.last_sign_in_at,
        twoStepSetUp: r.two_step_set_up,
        isYou: r.user_id === staff.userId,
        roleId: r.role_id,
        roleName: r.role_name,
        preset: r.preset,
      })),
    };
  });
}

export type TeamName = { userId: string; email: string; isYou: boolean };

/**
 * Who is on the team, by email only, for owner and assignee pickers and for
 * naming who did something. Every member may see it: a sales or support role
 * has no team.manage but still assigns tickets and owns leads.
 */
export function listTeamNamesHandler(): Promise<{ ok: true; members: TeamName[] } | PublicError> {
  return run(async () => {
    // Every role includes the dashboard (D39), so every member can name the team.
    const staff = await requireStaff("dashboard.view");
    const { data, error } = await getAdminClient().rpc("staff_list_admins");
    if (error) throw new Error(error.message);
    return {
      ok: true as const,
      members: ((data ?? []) as { user_id: string; email: string }[]).map((r) => ({
        userId: r.user_id,
        email: r.email,
        isYou: r.user_id === staff.userId,
      })),
    };
  });
}

/** Runs a D39 SQL function; its P0001 refusals are shown as they are. */
async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    // Races SQL can't word: the role went away (foreign key), or the name was just taken.
    if (error.code === "23503") throw new ConsoleError("conflict", "That role doesn't exist.");
    if (error.code === "23505") {
      throw new ConsoleError("conflict", "A role with that name already exists.");
    }
    throw new Error(`${fn}: ${error.message}`);
  }
}

export type AddAdminInput = { email: string; roleId: string; code?: string };

/**
 * What adding did: a new invite, the invite sent again to a console login that
 * was never set up, or a console login that was already set up (no email).
 */
export type AddOutcome = "invited" | "reinvited" | "existing";

const APP_ACCOUNT =
  "This email already has a Linara app account. Use a separate work email for the console.";

/**
 * Adds a member with a role (FR-TM-2). The code is needed for the admin and
 * mods roles; SQL decides, and refuses a role the person adding may not give.
 */
export function addAdminHandler(
  input: AddAdminInput,
): Promise<{ ok: true; outcome: AddOutcome } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email)) throw new ConsoleError("invalid_input", "Enter a work email.");
    if (!isUuid(input.roleId)) throw new ConsoleError("invalid_input", "Pick a role.");
    await checkRateLimit("add_admin", { adminId: staff.userId });

    // Checked before the code, so a refused email doesn't spend a code attempt (D30).
    const admin = getAdminClient();
    const { data: found, error: lookupError } = await admin.rpc("staff_lookup_user", {
      p_email: email,
    });
    if (lookupError) throw new Error(lookupError.message);
    const existing = (found as { user_id: string; has_household_profile: boolean }[] | null)?.[0];

    // A console login must never be a Linara app login too (§4.1). An app
    // profile shows it; so does a login the console didn't invite, since the
    // Linara app never sends invites (an app sign-up with no profile yet, or
    // whose profile was removed, still belongs to that person).
    if (existing?.has_household_profile) throw new ConsoleError("conflict", APP_ACCOUNT);
    let pendingInvite = false;
    if (existing) {
      const { data: found, error: userError } = await admin.auth.admin.getUserById(
        existing.user_id,
      );
      if (userError || !found.user) throw new Error(userError?.message ?? "login not found");
      if (!found.user.invited_at) throw new ConsoleError("conflict", APP_ACCOUNT);
      pendingInvite = !found.user.email_confirmed_at;
      const { data: member, error: memberError } = await admin
        .from("staff_roles")
        .select("user_id")
        .eq("user_id", existing.user_id)
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (member) throw new ConsoleError("conflict", "That email is already on the team.");
    }

    // The role is checked before anything is sent, so an invite email never
    // names a role the person won't get. SQL checks the same rules again (D39).
    const { data: role, error: roleError } = await admin
      .from("staff_role_defs")
      .select("name, preset, permissions")
      .eq("id", input.roleId)
      .maybeSingle<{ name: string; preset: RolePreset | null; permissions: string[] }>();
    if (roleError) throw new Error(roleError.message);
    if (!role) throw new ConsoleError("conflict", "That role doesn't exist.");
    const row: RoleRow = {
      roleId: input.roleId,
      preset: role.preset,
      name: role.name,
      description: null,
      permissions: role.permissions as Permission[],
      memberCount: 0,
      updatedAt: "",
    };
    if (role.preset === "super_admin") {
      throw new ConsoleError("conflict", "The super admin role can't be given from the console.");
    }
    if (assignableRoles(staff.preset, [row]).length === 0) {
      throw new ConsoleError(
        "conflict",
        staff.preset === "admin"
          ? "Only the super admin can give the admin role."
          : "Mods can't give the admin or mods role.",
      );
    }
    if (needsCode(row) && !input.code) {
      throw new ConsoleError("conflict", "Enter your two-step code to make this change.");
    }
    if (input.code) await requireFreshCode(staff, input.code);

    let userId: string;
    let outcome: AddOutcome;
    if (existing && !pendingInvite) {
      userId = existing.user_id;
      outcome = "existing";
    } else {
      // A new email, or a console invite never accepted: Supabase sends the
      // invite again for a login that was never confirmed.
      // The invite link expires per the project's email-link setting (S-7) and
      // lands on /accept-invite, then two-step setup (FR-TM-2).
      // Shown in the invite email (supabase/email-templates/invite.html). Kept on
      // the login's metadata, but never read for access: the role lives in staff_roles.
      const env = serverEnv();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${env.siteUrl}/accept-invite`,
        data: {
          invite_role: role.name,
          invite_permissions: PERMISSIONS.filter((p) => role.permissions.includes(p)).map(
            (p) => PERMISSION_LABEL[p],
          ),
          invited_by: staff.email,
          invite_environment: APP_ENV_LABEL[env.appEnv],
        },
      });
      if (error || !data.user) throw new Error(error?.message ?? "invite returned no user");
      userId = data.user.id;
      outcome = existing ? "reinvited" : "invited";
    }

    // Records itself in the audit log (D39), then tells the team's managers (FR-TM-4, D45).
    await call("staff_add_member", {
      p_actor: staff.userId,
      p_user_id: userId,
      p_role_id: input.roleId,
      p_code_checked: !!input.code,
    });
    await notifyMemberAdded({ actorEmail: staff.email, memberEmail: email, roleName: role.name });
    return { ok: true as const, outcome };
  });
}

export type RemoveAdminInput = { userId: string; code: string };

export function removeAdminHandler(input: RemoveAdminInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    if (input.userId === staff.userId)
      throw new ConsoleError("conflict", "You can't remove yourself.");
    if (!isUuid(input.userId))
      throw new ConsoleError("not_found", "That person isn't on the team.");
    await requireFreshCode(staff, input.code);

    // Read before removing, for the email; the removal goes ahead without it.
    const { data: removed } = await getAdminClient().auth.admin.getUserById(input.userId);
    await call("staff_remove_member", { p_actor: staff.userId, p_user_id: input.userId });
    // Their next request fails anyway (the role is gone); this ends their sessions now (FR-TM-3).
    await getAdminClient().rpc("staff_end_sessions", { p_user_id: input.userId });
    await notifyMemberRemoved({
      actorEmail: staff.email,
      memberEmail: removed?.user?.email ?? "A team member",
    });
    return { ok: true as const };
  });
}

export type ResetTwoStepInput = { userId: string; code: string };

/**
 * The super admin clears a member's two-step sign-in, for a lost or new phone
 * (D46). Their authenticator is removed and every session ends; on their next
 * sign-in they set two-step up again. Needs the super admin's own code.
 */
export function resetTwoStepHandler(input: ResetTwoStepInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    if (staff.preset !== "super_admin") {
      throw new ConsoleError("not_allowed", "Only the super admin can reset two-step sign-in.");
    }
    if (input.userId === staff.userId) {
      throw new ConsoleError("conflict", "You can't reset your own two-step sign-in.");
    }
    if (!isUuid(input.userId))
      throw new ConsoleError("not_found", "That person isn't on the team.");
    await checkRateLimit("team_change", { adminId: staff.userId });
    await requireFreshCode(staff, input.code);

    const admin = getAdminClient();
    const { data: member, error: memberError } = await admin
      .from("staff_roles")
      .select("user_id")
      .eq("user_id", input.userId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new ConsoleError("not_found", "That person isn't on the team.");

    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId: input.userId,
    });
    if (listError) throw new Error(listError.message);
    for (const factor of factors?.factors ?? []) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: input.userId,
      });
      if (error) throw new Error(error.message);
    }
    // Signed out everywhere, so nobody keeps a session from the old phone.
    await admin.rpc("staff_end_sessions", { p_user_id: input.userId });

    await writeAudit({
      actorId: staff.userId,
      action: "staff.two_step_reset",
      targetType: "staff",
      targetId: input.userId,
      metadata: { factors_removed: factors?.factors?.length ?? 0 },
    });
    const { data: target } = await admin.auth.admin.getUserById(input.userId);
    await notifyTwoStepReset({
      actorEmail: staff.email,
      memberEmail: target?.user?.email ?? "A team member",
    });
    return { ok: true as const };
  });
}
