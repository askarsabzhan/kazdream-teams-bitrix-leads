import { setLocaleAction } from "@/i18n/actions";
import type { Dictionary, Locale } from "@/i18n/types";

export function LanguageSwitcher({
  locale,
  labels,
  compact = false,
}: {
  locale: Locale;
  labels: Dictionary["locale"];
  compact?: boolean;
}) {
  return (
    <form
      action={setLocaleAction}
      aria-label={labels.label}
      className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950/70 p-1"
    >
      {(["ru", "en"] as const).map((value) => (
        <button
          aria-label={value === "ru" ? labels.russian : labels.english}
          aria-pressed={locale === value}
          className={`rounded-md font-semibold tracking-wide transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
            compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
          } ${locale === value ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:text-zinc-100"}`}
          key={value}
          name="locale"
          title={value === "ru" ? labels.russian : labels.english}
          type="submit"
          value={value}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
