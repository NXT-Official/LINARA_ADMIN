import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/i18n";

import { signInFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CaptchaField, type CaptchaFieldHandle } from "../components/captcha-field";
import { FormError } from "../components/form-error";

export function SignInPage({ reason }: { reason?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const captcha = useRef<CaptchaFieldHandle>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await signInFn({ data: { email, password, captchaToken: token } });
      if (res.ok) {
        navigate({ to: res.next === "two-step" ? "/sign-in/two-step" : "/sign-in/set-up" });
        return;
      }
      setError(res.message);
    } catch {
      setError(t("common.unexpectedError"));
    }
    // A captcha token works once: get a fresh one for the next try.
    captcha.current?.reset();
    setPending(false);
  }

  return (
    <AuthLayout
      title={t("signIn.title")}
      description={t("signIn.description")}
      footer={
        <Link to="/forgot-password" className="font-semibold text-pine hover:underline">
          {t("signIn.forgot")}
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {reason ? (
          <p role="status" className="rounded-xl bg-sand-deep px-3 py-2 text-sm text-pine-deep">
            {reason}
          </p>
        ) : null}
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
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <CaptchaField ref={captcha} onToken={setToken} />
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={!token || pending}>
          {pending ? t("signIn.signingIn") : t("signIn.continue")}
        </Button>
      </form>
    </AuthLayout>
  );
}
