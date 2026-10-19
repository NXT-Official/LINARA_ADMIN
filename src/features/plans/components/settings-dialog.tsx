import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Field, FormDialog } from "@/components/shared/form";
import { Input } from "@/components/ui/input";

import { saveBillingSettingsFn } from "../plans.actions";
import { PLAN_KEYS } from "../plans-keys";
import type { BillingSettings } from "../plans.types";

const checkCls = "h-4 w-4 accent-primary";

/** The seats text as a limit: null when unlimited, "bad" when it isn't a whole number. */
function seatsOf(unlimited: boolean, text: string): number | null | "bad" {
  if (unlimited) return null;
  return /^[0-9]+$/.test(text.trim()) && Number.isSafeInteger(Number(text)) ? Number(text) : "bad";
}

/**
 * The free tier: whether households without a plan can use Linara free, how
 * many seats that gives, and the support email shown to households. Mount it
 * only while it is open so each opening starts from what is saved.
 */
export function SettingsDialog({
  settings,
  open,
  onOpenChange,
}: {
  settings: BillingSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(settings.freeTierEnabled);
  const [helperUnlimited, setHelperUnlimited] = useState(settings.freeHelperSeats === null);
  const [helperSeats, setHelperSeats] = useState(String(settings.freeHelperSeats ?? ""));
  const [managerUnlimited, setManagerUnlimited] = useState(settings.freeManagerSeats === null);
  const [managerSeats, setManagerSeats] = useState(String(settings.freeManagerSeats ?? ""));
  const [email, setEmail] = useState(settings.supportEmail ?? "");
  const [errors, setErrors] = useState<{ helpers?: string; managers?: string }>({});

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Free tier"
      description="What a household gets before it has a plan."
      submitLabel="Save free tier"
      done="Free tier saved"
      onSubmit={async () => {
        const helpers = seatsOf(helperUnlimited, helperSeats);
        const managers = seatsOf(managerUnlimited, managerSeats);
        const found: { helpers?: string; managers?: string } = {};
        if (helpers === "bad") found.helpers = "Whole seats, zero or more.";
        if (managers === "bad") found.managers = "Whole seats, zero or more.";
        setErrors(found);
        if (helpers === "bad" || managers === "bad") {
          return { ok: false as const, message: "Fix the highlighted fields." };
        }
        const res = await saveBillingSettingsFn({
          data: {
            freeTierEnabled: enabled,
            freeHelperSeats: helpers,
            freeManagerSeats: managers,
            supportEmail: email.trim() === "" ? null : email.trim(),
          },
        });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: PLAN_KEYS.settings });
        return res;
      }}
    >
      {(id) => (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
            <input
              type="checkbox"
              className={checkCls}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Households without a plan can use Linara free
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Field
                label="Free helper seats"
                htmlFor={id("helpers")}
                hint={
                  errors.helpers ? <span className="text-destructive">{errors.helpers}</span> : null
                }
              >
                <Input
                  id={id("helpers")}
                  inputMode="numeric"
                  autoComplete="off"
                  value={helperSeats}
                  disabled={helperUnlimited}
                  aria-invalid={Boolean(errors.helpers)}
                  onChange={(e) => setHelperSeats(e.target.value)}
                />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className={checkCls}
                  checked={helperUnlimited}
                  onChange={(e) => setHelperUnlimited(e.target.checked)}
                />
                Unlimited helpers
              </label>
            </div>
            <div className="space-y-2">
              <Field
                label="Free manager seats"
                htmlFor={id("managers")}
                hint={
                  errors.managers ? (
                    <span className="text-destructive">{errors.managers}</span>
                  ) : null
                }
              >
                <Input
                  id={id("managers")}
                  inputMode="numeric"
                  autoComplete="off"
                  value={managerSeats}
                  disabled={managerUnlimited}
                  aria-invalid={Boolean(errors.managers)}
                  onChange={(e) => setManagerSeats(e.target.value)}
                />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className={checkCls}
                  checked={managerUnlimited}
                  onChange={(e) => setManagerUnlimited(e.target.checked)}
                />
                Unlimited managers
              </label>
            </div>
          </div>
          <Field
            label="Support email"
            htmlFor={id("email")}
            hint="Shown to households who need help."
          >
            <Input
              id={id("email")}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
