import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { AuthLayout } from "../components/auth-layout";
import { CodeField } from "../components/code-field";

// Sample only. Phase 1 gets a real secret and QR code from Supabase Auth's
// TOTP enrolment, and never stores or logs them.
const SAMPLE_SECRET = "JBSW Y3DP EHPK 3PXP";

/** First sign-in: no access until two-step sign-in is set up (S-1, FR-TM-2). */
export function SetUpTwoStepPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    navigate({ to: "/" });
  }

  return (
    <AuthLayout
      title="Set up two-step sign-in"
      description="Every admin signs in with a password and a code from their phone. This takes about a minute."
    >
      <form onSubmit={submit}>
        <ol className="list-decimal space-y-5 pl-5 text-sm text-foreground marker:font-semibold marker:text-muted-foreground">
          <li>
            Install an authenticator app on your phone, such as Google Authenticator or Microsoft
            Authenticator.
          </li>
          <li>
            Scan this code with the app.
            <div
              className="mt-3 grid aspect-square w-40 place-items-center rounded-xl border border-dashed border-input bg-sand text-xs text-muted-foreground"
              role="img"
              aria-label="QR code"
            >
              QR code
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Can't scan it? Enter this key instead:
            </p>
            <p className="mt-1 font-semibold tracking-wider text-foreground">{SAMPLE_SECRET}</p>
          </li>
          <li className="space-y-3">
            <span>Enter the code the app shows.</span>
            <CodeField value={code} onChange={setCode} id="setup-code" />
          </li>
        </ol>
        <Button type="submit" className="mt-6 w-full" disabled={code.length < 6}>
          Turn on two-step sign-in
        </Button>
      </form>
    </AuthLayout>
  );
}
