import { writeAudit } from "@/features/audit/audit.server";
import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

/**
 * Pay is hidden until an admin clicks Show, one field of one helper at a
 * time, and each reveal is recorded before the value leaves the server
 * (FR-US-6, S-17). The audit entry names the field, never the value (S-22).
 */

export type PayField = "wage" | "account";

export type PayoutAccount = {
  method: "PH_GCASH" | "PH_PAYMAYA";
  accountName: string;
  accountNumber: string;
};

export type RevealedPay =
  | { field: "wage"; monthlyRate: number | null }
  | { field: "account"; payoutAccount: PayoutAccount | null };

const NOT_FOUND = "That helper doesn't exist.";
const AUDIT_FIELD: Record<PayField, string> = { wage: "monthly_rate", account: "payout_account" };

export async function revealPayHandler(input: {
  helperId: string;
  field: PayField;
}): Promise<{ ok: true; pay: RevealedPay } | PublicError> {
  try {
    if (!isUuid(input.helperId)) throw new ConsoleError("not_found", NOT_FOUND);
    if (input.field !== "wage" && input.field !== "account") {
      throw new ConsoleError("invalid_input", "Pick what to show.");
    }
    const staff = await requireStaff("pay.view");

    const admin = getAdminClient();
    const { data: profile, error } = await admin
      .from("helper_profiles")
      .select(input.field === "wage" ? "monthly_rate" : "user_id")
      .eq("id", input.helperId)
      .maybeSingle<{ monthly_rate?: number | string | null; user_id?: string | null }>();
    if (error) throw new Error(error.message);
    if (!profile) throw new ConsoleError("not_found", NOT_FOUND);

    let pay: RevealedPay;
    if (input.field === "wage") {
      const rate = profile.monthly_rate;
      pay = {
        field: "wage",
        monthlyRate: rate === null || rate === undefined ? null : Number(rate),
      };
    } else {
      let payoutAccount: PayoutAccount | null = null;
      if (profile.user_id) {
        const { data: account, error: accountError } = await admin
          .from("helper_payout_accounts")
          .select("method, account_name, account_number")
          .eq("user_id", profile.user_id)
          .maybeSingle();
        if (accountError) throw new Error(accountError.message);
        if (account) {
          payoutAccount = {
            method: account.method,
            accountName: account.account_name,
            accountNumber: account.account_number,
          };
        }
      }
      pay = { field: "account", payoutAccount };
    }

    // Recorded first: if the write fails, nothing is shown (NFR-9).
    await writeAudit({
      actorId: staff.userId,
      action: "pay.revealed",
      targetType: "helper",
      targetId: input.helperId,
      metadata: { fields: AUDIT_FIELD[input.field] },
    });
    return { ok: true, pay };
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("pay reveal", e);
    return toPublicError(e);
  }
}
