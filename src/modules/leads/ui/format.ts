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

export function formatDuration(
  valueMs: number | null,
  locale: Locale,
  units: { seconds: string; minutes: string; hours: string },
): string {
  if (valueMs === null || valueMs < 0 || !Number.isFinite(valueMs)) return "—";
  const seconds = valueMs / 1000;
  const formatter = new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    maximumFractionDigits: seconds < 60 ? 1 : 0,
  });
  if (seconds < 60) return `${formatter.format(seconds)} ${units.seconds}`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${formatter.format(minutes)} ${units.minutes}`;
  return `${formatter.format(minutes / 60)} ${units.hours}`;
}

export function crmFilterStatus(status: string): "synced" | "pending" | "failed" {
  if (status === "succeeded") return "synced";
  if (["retryable_failed", "permanent_failed", "blocked"].includes(status)) return "failed";
  return "pending";
}
