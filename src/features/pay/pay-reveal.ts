import { formatPeso } from "@/lib/format";

import { revealPayFn } from "./pay.actions";
import type { PayField, PayoutAccount, RevealedPay } from "./pay.handlers.server";

const METHOD_LABEL: Record<PayoutAccount["method"], string> = {
  PH_GCASH: "GCash",
  PH_PAYMAYA: "Maya",
};

/**
 * One helper's pay, for HiddenValue buttons. Each button reveals only its own
 * field, so the server records exactly what the admin chose to see (S-17).
 */
export function payRevealer(helperId: string) {
  const load = async (field: PayField): Promise<RevealedPay> => {
    const res = await revealPayFn({ data: { helperId, field } });
    if (!res.ok) throw new Error(res.message);
    return res.pay;
  };
  return {
    wage: async () => {
      const pay = await load("wage");
      return pay.field === "wage" && pay.monthlyRate !== null ? formatPeso(pay.monthlyRate) : null;
    },
    account: async () => {
      const pay = await load("account");
      const a = pay.field === "account" ? pay.payoutAccount : null;
      return a ? `${METHOD_LABEL[a.method]} ${a.accountNumber}` : null;
    },
  };
}
