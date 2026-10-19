import { cn } from "@/lib/utils";
import { APP_ENV, type AppEnv } from "@/lib/env";
import { useT } from "@/lib/i18n/i18n";

// Non-production environments wear the attention wash, so nobody mistakes
// test data for the real thing. Production stays quiet.
const TONE: Record<AppEnv, string> = {
  development: "bg-terracotta-soft text-hearth-ink",
  staging: "bg-terracotta-soft text-hearth-ink",
  production: "bg-sand-deep text-pine-deep",
};

/** The current environment, shown on every screen (spec NFR-8). A status, so a pill. */
export function EnvBadge({ env = APP_ENV, className }: { env?: AppEnv; className?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE[env],
        className,
      )}
    >
      {t(`env.${env}`)}
    </span>
  );
}
