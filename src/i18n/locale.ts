import type { Locale } from "./types";

export const DEFAULT_LOCALE: Locale = "ru";
export const SUPPORTED_LOCALES = ["ru", "en"] as const satisfies readonly Locale[];
export const UI_LOCALE_COOKIE = "ui_locale";

export function resolveLocale(value: unknown): Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}
