export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-50">
      <section className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
          Phase 1 · Bootstrap
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Teams → Bitrix Leads
        </h1>
        <p className="mt-4 max-w-xl leading-7 text-zinc-300">
          The application foundation is ready. External integrations and lead
          processing will be added in later phases.
        </p>
      </section>
    </main>
  );
}
