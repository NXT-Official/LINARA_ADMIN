import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { setPasswordFromLinkFn } from "../auth.actions";
import { AuthLayout } from "./auth-layout";
import { FormError } from "./form-error";

type Tokens = { accessToken: string; refreshToken: string };

/**
 * Reads the tokens Supabase puts in a reset or invite link's #fragment, then
 * removes them from the address bar so they don't stay in history.
 */
function takeTokensFromHash(): Tokens | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

/** The page behind a password-reset link and an admin invite link (S-4, FR-TM-2). */
export function SetPasswordForm({ purpose }: { purpose: "recovery" | "invite" }) {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<Tokens | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => setTokens(takeTokensFromHash()), []);

  const title = purpose === "invite" ? "Welcome to the Business Console" : "Choose a new password";
  const description =
    purpose === "invite"
      ? "Choose a password for your console account. Next you'll set up two-step sign-in."
      : "Choose a new password for your console account.";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tokens) return;
    // Compares the two fields this person just typed, in their own browser.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await setPasswordFromLinkFn({ data: { ...tokens, password, purpose } });
      if (res.ok) {
        navigate({
          to: res.next,
          search:
            res.next === "/sign-in" ? { reason: "Password changed. Sign in with it now." } : {},
        });
        return;
      }
      setError(res.message);
    } catch {
      setError("Something went wrong on our side. Try again.");
    }
    setPending(false);
  }

  if (tokens === null) {
    return (
      <AuthLayout
        title={title}
        footer={
          <Link to="/forgot-password" className="font-semibold text-pine hover:underline">
            Ask for a new link
          </Link>
        }
      >
        <FormError message="This link has expired or was already used. Ask for a new one." />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} description={description}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={200}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">At least 12 characters.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Type it again</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={!tokens || pending}>
          {pending ? "Saving" : purpose === "invite" ? "Save and continue" : "Save password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
