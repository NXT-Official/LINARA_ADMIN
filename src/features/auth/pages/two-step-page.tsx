import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { verifyTwoStepFn } from "../auth.actions";
import { AuthLayout } from "../components/auth-layout";
import { CodeField } from "../components/code-field";
import { FormError } from "../components/form-error";

export function TwoStepPage() {
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
      setError("Something went wrong on our side. Try again.");
    }
    setCode("");
    setPending(false);
  }

  return (
    <AuthLayout
      title="Enter your code"
      description="Open your authenticator app and enter the code it shows for Linara Business Console."
      footer={
        <Link to="/sign-in" className="font-semibold text-pine hover:underline">
          Use a different account
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <CodeField value={code} onChange={setCode} />
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={code.length < 6 || pending}>
          {pending ? "Checking" : "Sign in"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Lost your phone? Ask another admin to reset your two-step sign-in.
        </p>
      </form>
    </AuthLayout>
  );
}
