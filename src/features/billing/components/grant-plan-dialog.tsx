import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeField } from "@/features/auth/components/code-field";
import { listPlansFn } from "@/features/plans/plans.actions";
import { PLAN_KEYS } from "@/features/plans/plans-keys";

import { grantPlanFn } from "../billing.actions";

const checkCls = "h-4 w-4 accent-primary";

type Seats = { value: string; unlimited: boolean };

/** The seats as a limit: null when unlimited, "bad" when it isn't a whole number. */
function seatsOf(s: Seats): number | null | "bad" {
  if (s.unlimited) return null;
  const t = s.value.trim();
  return /^[0-9]+$/.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : "bad";
}

function SeatsField({
  id,
  label,
  seats,
  onChange,
}: {
  id: string;
  label: string;
  seats: Seats;
  onChange: (next: Seats) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Field label={label} htmlFor={id}>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={seats.value}
          disabled={seats.unlimited}
          onChange={(e) => onChange({ ...seats, value: e.target.value })}
        />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className={checkCls}
          checked={seats.unlimited}
          onChange={(e) => onChange({ ...seats, unlimited: e.target.checked })}
        />
        Unlimited
      </label>
    </div>
  );
}

const EMPTY_SEATS: Seats = { value: "", unlimited: false };

/**
 * Comp a plan to one household, for nothing, until a date or with no end. Needs
 * the reason and the two-step code again (S-5); the audit log keeps the reason,
 * never an amount (S-22).
 */
export function GrantPlanDialog({
  trigger,
  householdId,
  onDone,
}: {
  trigger: ReactNode;
  householdId: string;
  onDone: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [helpers, setHelpers] = useState<Seats>(EMPTY_SEATS);
  const [managers, setManagers] = useState<Seats>(EMPTY_SEATS);
  const [periodEnd, setPeriodEnd] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");

  const plans = useQuery({ queryKey: PLAN_KEYS.plans, queryFn: () => listPlansFn() });
  const options = useMemo(() => {
    const all = plans.data?.ok ? plans.data.plans : [];
    const usable = all.filter((p) => p.status !== "draft");
    return [
      ...usable.filter((p) => p.status === "active").map((p) => ({ value: p.id, label: p.name })),
      ...usable
        .filter((p) => p.status === "archived")
        .map((p) => ({ value: p.id, label: `${p.name} (archived)` })),
    ];
  }, [plans.data]);

  const helperSeats = seatsOf(helpers);
  const managerSeats = seatsOf(managers);
  const canSubmit =
    planId !== "" &&
    helperSeats !== "bad" &&
    managerSeats !== "bad" &&
    reason.trim().length >= 1 &&
    code.length === 6;

  function reset() {
    setPlanId("");
    setHelpers(EMPTY_SEATS);
    setManagers(EMPTY_SEATS);
    setPeriodEnd("");
    setNote("");
    setReason("");
    setCode("");
  }

  return (
    <FormDialog
      trigger={trigger}
      title="Grant a plan"
      description="Gives this household a plan for nothing. It starts now and the household is told nothing."
      submitLabel="Grant plan"
      done="Plan granted"
      canSubmit={canSubmit}
      onOpenChange={(open) => {
        if (!open) reset();
      }}
      onSubmit={async () => {
        if (helperSeats === "bad" || managerSeats === "bad") {
          return { ok: false, message: "Seats must be whole numbers, or unlimited." };
        }
        const res = await grantPlanFn({
          data: {
            householdId,
            planId,
            helperSeats,
            managerSeats,
            periodEnd: periodEnd === "" ? null : periodEnd,
            note,
            reason,
            code,
          },
        });
        setCode("");
        if (res.ok) {
          reset();
          onDone();
        }
        return res;
      }}
    >
      {(id) => (
        <>
          <Field
            label="Plan"
            htmlFor={id("plan")}
            hint={
              plans.isError || (plans.data && !plans.data.ok)
                ? "The plans didn't load. Close this and try again."
                : undefined
            }
          >
            <SelectField
              id={id("plan")}
              value={planId}
              onChange={setPlanId}
              options={options}
              placeholder="Choose a plan"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <SeatsField
              id={id("helpers")}
              label="Helper seats"
              seats={helpers}
              onChange={setHelpers}
            />
            <SeatsField
              id={id("managers")}
              label="Manager seats"
              seats={managers}
              onChange={setManagers}
            />
          </div>
          <Field
            label="Period end"
            htmlFor={id("end")}
            hint="Leave blank for no end date. Ends 11:59 pm Manila time."
          >
            <Input
              id={id("end")}
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor={id("note")} hint="Optional, up to 500 characters.">
            <Textarea
              id={id("note")}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Field
            label="Reason"
            htmlFor={id("reason")}
            hint="Up to 200 characters. Saved in the audit log."
          >
            <Textarea
              id={id("reason")}
              rows={2}
              required
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <CodeField id={id("code")} value={code} onChange={setCode} />
        </>
      )}
    </FormDialog>
  );
}
