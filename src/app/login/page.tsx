import { redirect } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { getI18n } from "@/i18n/server";
import { getViewer } from "@/modules/auth/session";

export default async function LoginPage() {
  if (await getViewer()) redirect("/leads");
  const { dictionary, locale } = await getI18n();

  return (
    <main className="grid min-h-screen place-items-center bg-[#080b0e] px-4 py-8 text-zinc-50 sm:px-6">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-900 shadow-2xl shadow-black/30 md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden border-r border-zinc-800 bg-zinc-950 p-10 md:flex lg:p-12">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-emerald-400/10 bg-emerald-400/5" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400 text-sm font-black text-zinc-950 shadow-lg shadow-emerald-950/40">
                KD
              </span>
              <div>
                <p className="font-semibold text-zinc-100">{dictionary.product.name}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{dictionary.product.subtitle}</p>
              </div>
            </div>
            <p className="mt-24 max-w-md text-4xl font-semibold leading-tight tracking-tight text-zinc-50 lg:text-5xl">
              {dictionary.auth.title}
            </p>
            <p className="mt-5 max-w-md text-base leading-7 text-zinc-400">
              {dictionary.auth.description}
            </p>
          </div>
          <div className="relative grid gap-3 text-sm text-zinc-300">
            {[dictionary.auth.evidence, dictionary.auth.integrations].map((item) => (
              <div className="flex items-center gap-3" key={item}>
                <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-[540px] flex-col p-6 sm:p-9 md:min-h-[620px] lg:p-12">
          <div className="flex justify-end">
            <LanguageSwitcher labels={dictionary.locale} locale={locale} />
          </div>
          <div className="my-auto py-10">
            <div className="flex items-center gap-3 md:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 text-xs font-black text-zinc-950">KD</span>
              <div>
                <p className="font-semibold">{dictionary.product.name}</p>
                <p className="text-xs text-zinc-500">{dictionary.product.subtitle}</p>
              </div>
            </div>
            <p className="mt-9 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 md:mt-0">
              {dictionary.auth.secureAccess}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{dictionary.auth.loginHeading}</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-400 md:hidden">{dictionary.auth.description}</p>
            <LoginForm labels={dictionary.auth} />
          </div>
          <p className="text-center text-xs text-zinc-600">{dictionary.product.subtitle}</p>
        </div>
      </section>
    </main>
  );
}
