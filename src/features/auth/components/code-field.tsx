import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

/** The 6-digit authenticator code (S-1). */
export function CodeField({
  value,
  onChange,
  id = "code",
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>6-digit code</Label>
      <InputOTP
        id={id}
        maxLength={6}
        value={value}
        onChange={onChange}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="^[0-9]*$"
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
