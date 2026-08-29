import Link from "next/link";
import type { ReactNode } from "react";

import { AppNavigation } from "@/components/app-navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getI18n } from "@/i18n/server";
import { logoutAction } from "@/modules/auth/actions";
import { requireViewer } from "@/modules/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  const { dictionary, locale } = await getI18n();
  const viewerLabel = viewer.displayName ?? viewer.user.email ?? dictionary.common.unknown;
  const roleLabel = dictionary.roles[viewer.role];

  return (
    <div className="min-h-screen bg-[#080b0e] text-zinc-50 lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-zinc-800/80 bg-zinc-950/80 px-4 py-5 lg:flex">
        <Link className="flex items-center gap-3 rounded-xl px-2 py-2" href="/leads">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 text-xs font-black text-zinc-950 shadow-lg shadow-emerald-950/30">KD</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-100">{dictionary.product.name}</span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">{dictionary.product.subtitle}</span>
          </span>
        </Link>

        <div className="mt-8">
          <AppNavigation
            adminLabel={dictionary.navigation.admin}
            isAdmin={viewer.role === "admin"}
            leadsLabel={dictionary.navigation.leads}
            navigationLabel={dictionary.navigation.primary}
          />
        </div>

        <div className="mt-auto space-y-4 border-t border-zinc-800/80 pt-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-zinc-500">{dictionary.locale.label}</span>
            <LanguageSwitcher compact labels={dictionary.locale} locale={locale} />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="truncate text-sm font-medium text-zinc-200" title={viewerLabel}>{viewerLabel}</p>
            <p className="mt-1 text-xs text-zinc-500">{roleLabel}</p>
          </div>
          <form action={logoutAction}>
            <button className="flex w-full items-center justify-center rounded-xl border border-zinc-800 px-3 py-2.5 text-sm font-semibold text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white" type="submit">
              {dictionary.navigation.logout}
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-zinc-800/90 bg-[#080b0e]/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link className="flex min-w-0 items-center gap-2.5" href="/leads">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400 text-[11px] font-black text-zinc-950">KD</span>
              <span className="truncate text-sm font-semibold">{dictionary.product.name}</span>
            </Link>
            <LanguageSwitcher compact labels={dictionary.locale} locale={locale} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <AppNavigation
              adminLabel={dictionary.navigation.admin}
              isAdmin={viewer.role === "admin"}
              leadsLabel={dictionary.navigation.leads}
              mobile
              navigationLabel={dictionary.navigation.primary}
            />
            <form action={logoutAction}>
              <button className="rounded-lg border border-zinc-800 px-2.5 py-2 text-xs font-semibold text-zinc-400 transition hover:text-zinc-100" type="submit">
                {dictionary.navigation.logout}
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
