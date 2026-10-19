import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";

import { verifyTwoStepFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CodeField } from "../components/code-field";
import { FormError } from "../components/form-error";

export function TwoStepPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await verifyTwoStepFn({ data: { code } });
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

  return (
    <AuthLayout
      title={t("twoStep.title")}
      description={t("twoStep.description")}
      footer={
        <Link to="/sign-in" className="font-semibold text-pine hover:underline">
          {t("twoStep.otherAccount")}
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <CodeField value={code} onChange={setCode} />
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={code.length < 6 || pending}>
          {pending ? t("auth.checking") : t("twoStep.signIn")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("twoStep.lostPhone")}</p>
      </form>
    </AuthLayout>
  );
}
