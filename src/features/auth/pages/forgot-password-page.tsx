import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/i18n";

import { requestPasswordResetFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CaptchaField, type CaptchaFieldHandle } from "../components/captcha-field";
import { FormError } from "../components/form-error";

export function ForgotPasswordPage() {
  const t = useT();
  const captcha = useRef<CaptchaFieldHandle>(null);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await requestPasswordResetFn({ data: { email, captchaToken: token } });
      if (res.ok) {
        setSent(true);
        return;
      }
      setError(res.message);
    } catch {
      setError(t("common.unexpectedError"));
    }
    captcha.current?.reset();
    setPending(false);
  }

  return (
    <AuthLayout
      title={t("forgot.title")}
      description={t("forgot.description")}
      footer={
        <Link to="/sign-in" className="font-semibold text-pine hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      }
    >
      {sent ? (
        // The same answer whether or not the email has an account (S-4).
        <p role="status" className="text-sm text-foreground">
          {t("forgot.sent", { email })}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.workEmail")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <CaptchaField ref={captcha} onToken={setToken} />
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={!token || pending}>
            {pending ? t("forgot.sending") : t("forgot.send")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
