import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getViewer } from "@/modules/auth/session";

export default async function LoginPage() {
  if (await getViewer()) redirect("/leads");

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-5 py-12 text-zinc-50">
      <section className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-7 shadow-2xl shadow-black/30 sm:p-9">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 font-bold text-zinc-950">
          KD
        </div>
        <p className="mt-7 text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">
          Lead workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Teams → Bitrix</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Sign in with your evaluator account to inspect canonical leads and their source evidence.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
