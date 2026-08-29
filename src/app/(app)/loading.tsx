"use client";

import { useDictionary } from "@/i18n/provider";

export default function Loading() {
  const dictionary = useDictionary();
  return (
    <div className="animate-pulse space-y-5" aria-label={dictionary.common.loading} role="status">
      <span className="sr-only">{dictionary.common.loading}</span>
      <div className="h-9 w-56 rounded-lg bg-zinc-800" />
      <div className="h-28 rounded-2xl border border-zinc-800 bg-zinc-900" />
      <div className="h-72 rounded-2xl border border-zinc-800 bg-zinc-900" />
    </div>
  );
}
