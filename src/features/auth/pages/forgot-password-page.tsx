import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AuthLayout, CaptchaSlot } from "../components/auth-layout";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your console work email and we'll send a reset link."
      footer={
        <Link to="/sign-in" className="font-semibold text-pine hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        // The same answer whether or not the email has an account (S-4).
        <p role="status" className="text-sm text-foreground">
          If {email || "that email"} has a console account, a reset link is on its way. It works
          once and only on this console.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
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
          <CaptchaSlot />
          <Button type="submit" className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
