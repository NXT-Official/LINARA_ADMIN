import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { startTwoStepSetupFn, verifyTwoStepFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CodeField } from "../components/code-field";
import { FormError } from "../components/form-error";

type Setup = { factorId: string; qrCode: string; secret: string };

/** First sign-in: no access until two-step sign-in is set up (S-1, FR-TM-2). */
export function SetUpTwoStepPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // One setup request per page, even when React runs this effect twice: two
  // requests at once would each replace the other's authenticator.
  const started = useRef<ReturnType<typeof startTwoStepSetupFn> | null>(null);

  useEffect(() => {
    let cancelled = false;
    started.current ??= startTwoStepSetupFn();
    started.current
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setSetup(res);
        else setLoadError(res.message);
      })
      .catch(() => !cancelled && setLoadError("Something went wrong on our side. Try again."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setPending(true);
    setError(null);
    try {
      const res = await verifyTwoStepFn({ data: { code, factorId: setup.factorId } });
      if (res.ok) {
        queryClient.removeQueries({ queryKey: ["console-session"] });
        navigate({ to: "/" });
        return;
      }
      setError(res.message);
    } catch {
      setError("Something went wrong on our side. Try again.");
    }
    setCode("");
    setPending(false);
  }

  if (loadError) {
    return (
      <AuthLayout
        title="Set up two-step sign-in"
        footer={
          <Link to="/sign-in" className="font-semibold text-pine hover:underline">
            Back to sign in
          </Link>
        }
      >
        <FormError message={loadError} />
      </AuthLayout>
    );
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
            {setup ? (
              <img
                src={setup.qrCode}
                alt="QR code for your authenticator app"
                className="mt-3 aspect-square w-40 rounded-xl bg-white p-2"
              />
            ) : (
              <div
                className="mt-3 aspect-square w-40 rounded-xl bg-sand-deep"
                aria-label="Loading the QR code"
                role="img"
              />
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Can't scan it? Enter this key instead:
            </p>
            <p className="mt-1 break-all font-semibold tracking-wider text-foreground">
              {setup ? setup.secret.replace(/(.{4})/g, "$1 ").trim() : ""}
            </p>
          </li>
          <li className="space-y-3">
            <span>Enter the code the app shows.</span>
            <CodeField value={code} onChange={setCode} id="setup-code" />
          </li>
        </ol>
        <div className="mt-6 space-y-3">
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={!setup || code.length < 6 || pending}>
            {pending ? "Checking" : "Turn on two-step sign-in"}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
