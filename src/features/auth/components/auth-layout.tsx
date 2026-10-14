import type { ReactNode } from "react";

import { EnvBadge } from "@/components/shared/env-badge";
import { Logo } from "@/components/shared/logo";

/** The frame around sign-in, two-step and reset: one quiet surface, the brand above it. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-sm items-center justify-between">
        <Logo />
        <EnvBadge />
      </div>
      <div className="mx-auto mt-10 w-full max-w-sm sm:mt-16">
        <h1 className="text-2xl text-foreground">{title}</h1>
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
        <section className="mt-6 rounded-3xl bg-card p-5 shadow-soft sm:p-7">{children}</section>
        {footer ? (
          <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Where the hCaptcha widget mounts (S-3). The real widget arrives with
 * sign-in in Phase 1; this holds its size so the layout doesn't jump.
 */
export function CaptchaSlot() {
  return (
    <div
      className="grid h-[78px] w-full place-items-center rounded-xl border border-dashed border-input bg-sand text-xs text-muted-foreground"
      role="img"
      aria-label="Captcha check"
    >
      Captcha check
    </div>
  );
}
