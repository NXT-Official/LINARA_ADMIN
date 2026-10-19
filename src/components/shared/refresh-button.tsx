import { useIsFetching, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n/i18n";
import { localeInfo } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

const timeFmt = (intl: string) =>
  new Intl.DateTimeFormat(intl, { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

/**
 * Reloads one screen's data. Loaded data stays cached until this is pressed or
 * a change on the console makes it out of date, so moving between screens
 * doesn't ask the database again (D31, D41).
 */
export function RefreshButton({
  queryKeys,
  updatedAt,
  className,
}: {
  /** The screen's query keys; every query starting with one is reloaded. */
  queryKeys: QueryKey[];
  /** When the screen's data was loaded (`dataUpdatedAt`), 0 before it has been. */
  updatedAt?: number;
  className?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const fetching =
    useIsFetching({
      predicate: (q) =>
        queryKeys.some((k) => k.every((part, i) => sameKeyPart(q.queryKey[i], part))),
    }) > 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {updatedAt ? (
        <span className="text-xs text-muted-foreground">
          {t("refresh.loaded", {
            time: timeFmt(localeInfo(locale).intl).format(new Date(updatedAt)),
          })}
        </span>
      ) : null}
      <Button
        variant="outline"
        disabled={fetching}
        onClick={() =>
          Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
        }
      >
        <RefreshCw aria-hidden="true" className={cn(fetching && "animate-spin")} />
        {fetching ? t("refresh.refreshing") : t("refresh.refresh")}
      </Button>
    </div>
  );
}

function sameKeyPart(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
