import Link from "next/link";

import { requireViewer } from "@/modules/auth/session";

export default async function ForbiddenPage() {
  await requireViewer();
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-5 text-zinc-50">
      <section className="max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-amber-300">Not authorized</p>
        <h1 className="mt-3 text-3xl font-semibold">Admin access is required.</h1>
        <p className="mt-3 text-zinc-400">Your account can continue working with leads.</p>
        <Link className="mt-6 inline-flex rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-zinc-950" href="/leads">
          Go to leads
        </Link>
      </section>
    </main>
  );
}
