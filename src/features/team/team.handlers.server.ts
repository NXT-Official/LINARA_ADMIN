import { writeAudit } from "@/features/audit/audit.server";
import { checkRateLimit } from "@/features/auth/rate-limit.server";
import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { serverEnv } from "@/lib/server-env.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

/** The Admins screen (FR-TM-1 to FR-TM-3, D28, D31). */

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
};

export function listAdminsHandler(): Promise<{ ok: true; admins: AdminRow[] } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    // One query for every admin, instead of one Auth call each (D31).
    const { data, error } = await getAdminClient().rpc("staff_list_admins");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      user_id: string;
      email: string;
      granted_at: string;
      last_sign_in_at: string | null;
      two_step_set_up: boolean;
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
      })),
    };
  });
}

export type AddAdminInput = { email: string; code: string };

export function addAdminHandler(input: AddAdminInput): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("team.manage");
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email)) throw new ConsoleError("invalid_input", "Enter a work email.");
    await checkRateLimit("add_admin", { adminId: staff.userId });
    await requireFreshCode(staff, input.code);

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
      const { data: role } = await admin
        .from("staff_roles")
        .select("role")
        .eq("user_id", existing.user_id)
        .maybeSingle();
      if (role) throw new ConsoleError("conflict", "That email is already an admin.");
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

    const { error: insertError } = await admin
      .from("staff_roles")
      .insert({ user_id: userId, role: "admin", granted_by: staff.userId });
    if (insertError) throw new Error(insertError.message);

    // FR-TM-4's email to every admin waits for an email service (OQ-13).
    await writeAudit({
      actorId: staff.userId,
      action: "staff.added",
      targetType: "staff",
      targetId: userId,
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

    const admin = getAdminClient();
    const { data: roles, error } = await admin.from("staff_roles").select("user_id");
    if (error) throw new Error(error.message);
    const ids = ((roles ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (!ids.includes(input.userId))
      throw new ConsoleError("not_found", "That admin doesn't exist.");
    if (ids.length <= 1) throw new ConsoleError("conflict", "There has to be at least one admin.");

    await requireFreshCode(staff, input.code);

    const { error: deleteError } = await admin
      .from("staff_roles")
      .delete()
      .eq("user_id", input.userId);
    if (deleteError) throw new Error(deleteError.message);
    // Their next request fails anyway (the role is gone); this ends their sessions now (FR-TM-3).
    await admin.rpc("staff_end_sessions", { p_user_id: input.userId });

    await writeAudit({
      actorId: staff.userId,
      action: "staff.removed",
      targetType: "staff",
      targetId: input.userId,
    });
    return { ok: true as const };
  });
}
