"use client";

import { useDictionary } from "@/i18n/provider";

export default function AppError({ reset }: { reset: () => void }) {
  const dictionary = useDictionary();
  return (
    <section className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-7">
      <p className="text-sm font-medium text-rose-300">{dictionary.system.safeError}</p>
      <h1 className="mt-2 text-2xl font-semibold">{dictionary.system.loadFailed}</h1>
      <p className="mt-2 text-zinc-400">{dictionary.system.safeErrorHint}</p>
      <button className="mt-5 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950" onClick={reset} type="button">
        {dictionary.system.tryAgain}
      </button>
    </section>
  );
}
