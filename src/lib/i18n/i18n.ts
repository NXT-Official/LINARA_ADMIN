import { createContext, useCallback, useContext } from "react";

import { DEFAULT_LOCALE, type Locale } from "./locales";
import { MESSAGES, type MessageKey } from "./messages";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Fills `{name}` placeholders. A missing value leaves the placeholder showing. */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const text = MESSAGES[locale][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : text;
}

export type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void };

// Outside a provider (unit tests of a single component) everything is English.
export const LocaleContext = createContext<LocaleState>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const { locale } = useContext(LocaleContext);
  return useCallback<Translate>((key, vars) => translate(locale, key, vars), [locale]);
}
