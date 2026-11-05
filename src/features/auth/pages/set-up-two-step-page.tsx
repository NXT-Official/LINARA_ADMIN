import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";

import { startTwoStepSetupFn, verifyTwoStepFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CodeField } from "../components/code-field";
import { FormError } from "../components/form-error";

type Setup = { factorId: string; qrCode: string; secret: string };

/** First sign-in: no access until two-step sign-in is set up (S-1, FR-TM-2). */
export function SetUpTwoStepPage() {
  const t = useT();
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
      .catch(() => !cancelled && setLoadError(""));
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
      setError(t("common.unexpectedError"));
    }
    setCode("");
    setPending(false);
  }

  // "" is our own failure, worded in the admin's language when shown.
  if (loadError !== null) {
    return (
      <AuthLayout
        title={t("setUp.title")}
        footer={
          <Link to="/sign-in" className="font-semibold text-pine hover:underline">
            {t("auth.backToSignIn")}
          </Link>
        }
      >
        <FormError message={loadError || t("common.unexpectedError")} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("setUp.title")} description={t("setUp.description")}>
      <form onSubmit={submit}>
        <ol className="list-decimal space-y-5 pl-5 text-sm text-foreground marker:font-semibold marker:text-muted-foreground">
          <li>{t("setUp.install")}</li>
          <li>
            {t("setUp.scan")}
            {setup ? (
              <img
                src={setup.qrCode}
                alt={t("setUp.qrAlt")}
                className="mt-3 aspect-square w-40 rounded-xl bg-white p-2"
              />
            ) : (
              <div
                className="mt-3 aspect-square w-40 rounded-xl bg-sand-deep"
                aria-label={t("setUp.qrLoading")}
                role="img"
              />
            )}
            <p className="mt-3 text-xs text-muted-foreground">{t("setUp.cantScan")}</p>
            <p className="mt-1 break-all font-semibold tracking-wider text-foreground">
              {setup ? setup.secret.replace(/(.{4})/g, "$1 ").trim() : ""}
            </p>
          </li>
          <li className="space-y-3">
            <span>{t("setUp.enterCode")}</span>
            <CodeField value={code} onChange={setCode} id="setup-code" />
          </li>
        </ol>
        <div className="mt-6 space-y-3">
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={!setup || code.length < 6 || pending}>
            {pending ? t("auth.checking") : t("setUp.turnOn")}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
