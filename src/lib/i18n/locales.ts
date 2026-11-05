/**
 * The console's languages (D42). English is the default and the source every
 * other language is checked against. Each label is in its own language, so
 * anyone can find theirs.
 */
export const LOCALES = [
  { code: "en", label: "English", short: "EN", intl: "en-PH" },
  { code: "fil", label: "Filipino", short: "FIL", intl: "fil-PH" },
  { code: "es", label: "Español", short: "ES", intl: "es" },
  { code: "zh-CN", label: "简体中文", short: "中文", intl: "zh-CN" },
  { code: "ja", label: "日本語", short: "日本語", intl: "ja-JP" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

/** Holds the admin's language only: no account or personal data (D41, D42). */
export const LOCALE_COOKIE = "linara_locale";

export function parseLocale(raw: string | null | undefined): Locale {
  return LOCALES.find((l) => l.code === raw)?.code ?? DEFAULT_LOCALE;
}

export function localeInfo(locale: Locale) {
  return LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
}
