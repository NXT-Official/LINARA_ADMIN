import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AuthLayout, CaptchaSlot } from "../components/auth-layout";

export function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    // Phase 1: the server checks the password, the captcha and the console role,
    // and answers the same way for a wrong password and a non-admin (S-2).
    navigate({ to: "/sign-in/two-step" });
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
        <CaptchaSlot />
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}
