import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/i18n";

/**
 * The 6-digit authenticator code (S-1). Says whose code it is and where it
 * comes from: a dialog that confirms a change adds why, e.g. "It confirms
 * it's you adding them."
 */
export function CodeField({
  value,
  onChange,
  id = "code",
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  hint?: string;
}) {
  const t = useT();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("auth.codeLabel")}</Label>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint ?? t("auth.codeHint")}
      </p>
      <InputOTP
        id={id}
        maxLength={6}
        value={value}
        onChange={onChange}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="^[0-9]*$"
        aria-describedby={hintId}
      >
        <InputOTPGroup className="w-full justify-between gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <InputOTPSlot
              key={i}
              index={i}
              className="h-12 flex-1 rounded-xl border border-input bg-sand text-base first:rounded-l-xl last:rounded-r-xl"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}
