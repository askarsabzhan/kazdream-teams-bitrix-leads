import Link from "next/link";

import { getI18n } from "@/i18n/server";

export default async function NotFound() {
  const { dictionary } = await getI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-5 text-zinc-50">
      <section className="max-w-lg text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-300">404</p>
        <h1 className="mt-3 text-3xl font-semibold">{dictionary.system.notFoundTitle}</h1>
        <p className="mt-3 text-zinc-400">{dictionary.system.notFoundDescription}</p>
        <Link className="mt-6 inline-flex rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-zinc-950" href="/leads">
          {dictionary.system.backToLeads}
        </Link>
      </section>
    </main>
  );
}
