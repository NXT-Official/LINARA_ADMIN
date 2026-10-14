import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { AuthLayout } from "../components/auth-layout";
import { CodeField } from "../components/code-field";

export function TwoStepPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    navigate({ to: "/" });
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
        <Button type="submit" className="w-full" disabled={code.length < 6}>
          Sign in
        </Button>
        <p className="text-xs text-muted-foreground">
          Lost your phone? Ask another admin to reset your two-step sign-in.
        </p>
      </form>
    </AuthLayout>
  );
}
