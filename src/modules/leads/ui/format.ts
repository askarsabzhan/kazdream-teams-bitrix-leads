import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/types";

export function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function formatDateTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

export function localizeValue(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const localized = getDictionary(locale).values[value.trim().toLocaleLowerCase()];
  return localized ?? humanize(value);
}

export function crmFilterStatus(status: string): "synced" | "pending" | "failed" {
  if (status === "succeeded") return "synced";
  if (["retryable_failed", "permanent_failed", "blocked"].includes(status)) return "failed";
  return "pending";
}
