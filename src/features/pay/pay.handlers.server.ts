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

/**
 * The wage in force today, as LINARA's helper_rate_on reads it: the latest
 * rate that has started, else her first one, else the profile's newest rate.
 * A raise set for the next cutoff isn't in force yet, so it isn't shown.
 */
async function rateInForce(
  admin: ReturnType<typeof getAdminClient>,
  helperId: string,
  profileRate: number | string | null | undefined,
): Promise<number | string | null | undefined> {
  const { data, error } = await admin
    .from("helper_wage_rates")
    .select("monthly_rate, effective_from")
    .eq("helper_id", helperId)
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  const rates = (data ?? []) as { monthly_rate: number | string; effective_from: string }[];
  if (rates.length === 0) return profileRate;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return (rates.find((r) => r.effective_from <= today) ?? rates[rates.length - 1]).monthly_rate;
}

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
      const rate = await rateInForce(admin, input.helperId, profile.monthly_rate);
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

const NO_ATTEMPT = "That payout doesn't exist.";

/**
 * One payout attempt's amount (FR-PO-1, D38): read with its helper in one
 * select, recorded before it leaves the server, ids only in the audit (S-22).
 */
export async function revealPayoutAmountHandler(input: {
  attemptId: string;
}): Promise<{ ok: true; amount: number } | PublicError> {
  try {
    if (!isUuid(input.attemptId)) throw new ConsoleError("not_found", NO_ATTEMPT);
    const staff = await requireStaff("pay.view");

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("payout_attempts")
      .select("amount_sent, payslips(helper_id)")
      .eq("id", input.attemptId)
      .maybeSingle<{ amount_sent: number | string; payslips: { helper_id: string } | null }>();
    if (error) throw new Error(error.message);

    let amount: number | string;
    let helperId: string;
    if (data?.payslips) {
      amount = data.amount_sent;
      helperId = data.payslips.helper_id;
    } else {
      // A disputed direct payment has no attempt: its row id is the payslip's.
      const { data: slip, error: slipError } = await admin
        .from("payslips")
        .select("net_pay, helper_id")
        .eq("id", input.attemptId)
        .maybeSingle<{ net_pay: number | string; helper_id: string }>();
      if (slipError) throw new Error(slipError.message);
      if (!slip) throw new ConsoleError("not_found", NO_ATTEMPT);
      amount = slip.net_pay;
      helperId = slip.helper_id;
    }

    await writeAudit({
      actorId: staff.userId,
      action: "pay.revealed",
      targetType: "helper",
      targetId: helperId,
      metadata: { fields: "payout_amount", attempt_id: input.attemptId },
    });
    return { ok: true, amount: Number(amount) };
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("payout amount reveal", e);
    return toPublicError(e);
  }
}
