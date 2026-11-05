import { useCallback, useMemo, useState, type ReactNode } from "react";

import { LocaleContext } from "./i18n";
import { writeLocale } from "./locale-cookie";
import type { Locale } from "./locales";

/** Holds the admin's language; a change shows at once and is kept in its cookie (D42). */
export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState(initial);
  const setLocale = useCallback((next: Locale) => {
    writeLocale(next);
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
