import { writeAudit } from "@/features/audit/audit.server";
import { requireFreshCode } from "@/features/auth/reauth.server";
import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

/**
 * Suspending blocks a user from signing in again through Supabase Auth's ban,
 * until unsuspended (FR-US-4, FR-US-5, D36). It needs a reason and the
 * two-step code again (S-5). A session already open lasts until it expires.
 */

const FOREVER = "876000h"; // 100 years: Supabase's "until unbanned"

export async function setSuspendedHandler(input: {
  userId: string;
  suspended: boolean;
  reason: string;
  code: string;
}): Promise<{ ok: true } | PublicError> {
  try {
    if (!isUuid(input.userId))
      throw new ConsoleError("not_found", "There's no user with this address.");
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 300) {
      throw new ConsoleError("invalid_input", "Give a reason of 5 to 300 characters.");
    }
    const staff = await requireStaff("users.suspend");

    const admin = getAdminClient();
    const { data: isAdmin, error: adminError } = await admin.rpc("staff_is_console_admin", {
      p_user_id: input.userId,
    });
    if (adminError) throw new Error(adminError.message);
    if (isAdmin) {
      throw new ConsoleError("not_allowed", "Team members are managed on the Team screen.");
    }

    await requireFreshCode(staff, input.code);

    const { error } = await admin.auth.admin.updateUserById(input.userId, {
      ban_duration: input.suspended ? FOREVER : "none",
    });
    if (error) {
      if (error.status === 404) {
        throw new ConsoleError("not_found", "There's no user with this address.");
      }
      throw new Error(`ban: ${error.message}`);
    }

    await writeAudit({
      actorId: staff.userId,
      action: input.suspended ? "user.suspended" : "user.unsuspended",
      targetType: "user",
      targetId: input.userId,
      reason,
    });
    return { ok: true };
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("suspend", e);
    return toPublicError(e);
  }
}
