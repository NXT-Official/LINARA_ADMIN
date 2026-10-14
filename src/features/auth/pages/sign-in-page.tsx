import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signInFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CaptchaField, type CaptchaFieldHandle } from "../components/captcha-field";
import { FormError } from "../components/form-error";

export function SignInPage({ reason }: { reason?: string }) {
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
      setError("Something went wrong on our side. Try again.");
    }
    // A captcha token works once: get a fresh one for the next try.
    captcha.current?.reset();
    setPending(false);
  }

  return (
    <AuthLayout
      title="Sign in to the Business Console"
      description="Use your console work email. Household accounts can't sign in here."
      footer={
        <Link to="/forgot-password" className="font-semibold text-pine hover:underline">
          Forgot your password?
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
          <Label htmlFor="email">Work email</Label>
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
          <Label htmlFor="password">Password</Label>
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
          {pending ? "Signing in" : "Continue"}
        </Button>
      </form>
    </AuthLayout>
  );
}
