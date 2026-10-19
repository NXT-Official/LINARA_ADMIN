import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale, useT } from "@/lib/i18n/i18n";
import { LOCALES, localeInfo, parseLocale } from "@/lib/i18n/locales";

/** The language picker, one click away on every screen, signed in or not (D42). */
export function LanguageMenu() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const current = localeInfo(locale);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2.5"
          aria-label={t("language.current", { language: current.label })}
        >
          <Languages aria-hidden="true" />
          <span className="text-xs font-semibold">{current.short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 rounded-xl">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("language.label")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(parseLocale(v))}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code} lang={l.code}>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
