import { checkRateLimit } from "@/features/auth/rate-limit.server";
import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import type { RolePreset } from "@/features/auth/permissions";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { serverEnv } from "@/lib/server-env.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

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
 * Adds a member with a role (FR-TM-2). The code is needed for the admin and
 * mods roles; SQL decides, and refuses a role the person adding may not give.
 */
export function addAdminHandler(input: AddAdminInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email)) throw new ConsoleError("invalid_input", "Enter a work email.");
    if (!isUuid(input.roleId)) throw new ConsoleError("invalid_input", "Pick a role.");
    await checkRateLimit("add_admin", { adminId: staff.userId });
    if (input.code) await requireFreshCode(staff, input.code);

    const admin = getAdminClient();
    const { data: found, error: lookupError } = await admin.rpc("staff_lookup_user", {
      p_email: email,
    });
    if (lookupError) throw new Error(lookupError.message);
    const existing = (found as { user_id: string; has_household_profile: boolean }[] | null)?.[0];

    if (existing?.has_household_profile) {
      throw new ConsoleError(
        "conflict",
        "That email has a Linara household account. Use an email only for the console.",
      );
    }

    let userId: string;
    if (existing) {
      userId = existing.user_id;
    } else {
      // The invite link expires per the project's email-link setting (S-7) and
      // lands on /accept-invite, then two-step setup (FR-TM-2).
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${serverEnv().siteUrl}/accept-invite`,
      });
      if (error || !data.user) throw new Error(error?.message ?? "invite returned no user");
      userId = data.user.id;
    }

    // Records itself in the audit log (D39). FR-TM-4's email waits for OQ-13.
    await call("staff_add_member", {
      p_actor: staff.userId,
      p_user_id: userId,
      p_role_id: input.roleId,
      p_code_checked: !!input.code,
    });
    return { ok: true as const };
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

    await call("staff_remove_member", { p_actor: staff.userId, p_user_id: input.userId });
    // Their next request fails anyway (the role is gone); this ends their sessions now (FR-TM-3).
    await getAdminClient().rpc("staff_end_sessions", { p_user_id: input.userId });
    return { ok: true as const };
  });
}
