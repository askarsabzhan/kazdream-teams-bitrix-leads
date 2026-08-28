import Link from "next/link";
import type { ReactNode } from "react";

import { logoutAction } from "@/modules/auth/actions";
import { requireViewer } from "@/modules/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="sticky top-0 z-20 border-b border-zinc-800/90 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4 sm:gap-8">
            <Link className="flex shrink-0 items-center gap-2 font-semibold" href="/leads">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-400 text-xs font-bold text-zinc-950">
                KD
              </span>
              <span className="hidden sm:inline">Lead workspace</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm text-zinc-300" aria-label="Primary">
              <Link className="rounded-lg px-3 py-2 transition hover:bg-zinc-800 hover:text-white" href="/leads">
                Leads
              </Link>
              {viewer.role === "admin" ? (
                <Link className="rounded-lg px-3 py-2 transition hover:bg-zinc-800 hover:text-white" href="/admin">
                  Admin
                </Link>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-zinc-700 px-2.5 py-1 text-xs capitalize text-zinc-400 sm:inline">
              {viewer.role}
            </span>
            <form action={logoutAction}>
              <button className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white" type="submit">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
