import { cn } from "@/lib/utils";
import { APP_ENV, type AppEnv } from "@/lib/env";
import { useT } from "@/lib/i18n/i18n";

/**
 * The current environment on every non-production screen (spec NFR-8), in the
 * attention wash so nobody mistakes test data for the real thing. Production
 * shows nothing.
 */
export function EnvBadge({ env = APP_ENV, className }: { env?: AppEnv; className?: string }) {
  const t = useT();
  if (env === "production") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-terracotta-soft px-2.5 py-0.5 text-xs font-semibold text-hearth-ink",
        className,
      )}
    >
      {t(`env.${env}`)}
    </span>
  );
}
