"use client";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <section className="rounded-2xl border border-red-900/50 bg-red-950/20 p-7">
      <p className="text-sm font-medium text-red-300">Safe error</p>
      <h1 className="mt-2 text-2xl font-semibold">The requested data could not be loaded.</h1>
      <p className="mt-2 text-zinc-400">No provider details or source content were exposed.</p>
      <button className="mt-5 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950" onClick={reset} type="button">
        Try again
      </button>
    </section>
  );
}
