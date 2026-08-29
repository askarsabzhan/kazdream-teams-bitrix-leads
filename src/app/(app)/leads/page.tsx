import Link from "next/link";

import { StatusBadge, statusTone } from "@/components/status-badge";
import { getI18n } from "@/i18n/server";
import { requireViewer } from "@/modules/auth/session";
import { loadLeads } from "@/modules/leads/ui/data";
import {
  crmFilterStatus,
  displayValue,
  formatDateTime,
  localizeValue,
} from "@/modules/leads/ui/format";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; crm?: string }>;
}) {
  await requireViewer();
  const { dictionary, locale } = await getI18n();
  const leads = await loadLeads();
  const { q = "", crm = "" } = await searchParams;
  const localeName = locale === "ru" ? "ru-RU" : "en-US";
  const safeQuery = q.trim().slice(0, 120).toLocaleLowerCase(localeName);
  const safeCrm = ["synced", "pending", "failed"].includes(crm) ? crm : "";
  const filtered = leads.filter((lead) => {
    const searchable = `${lead.fullName ?? ""} ${lead.company ?? ""}`.toLocaleLowerCase(localeName);
    return (
      (!safeQuery || searchable.includes(safeQuery)) &&
      (!safeCrm || crmFilterStatus(lead.crmStatus) === safeCrm)
    );
  });
  const stats = [
    { label: dictionary.leads.total, value: leads.length },
    { label: dictionary.leads.synced, value: leads.filter((lead) => lead.crmStatus === "succeeded").length },
    { label: dictionary.leads.partners, value: leads.filter((lead) => lead.leadType.toLocaleLowerCase() === "partner").length },
    { label: dictionary.leads.customers, value: leads.filter((lead) => lead.leadType.toLocaleLowerCase() === "customer").length },
  ];

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">{dictionary.leads.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{dictionary.leads.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{dictionary.leads.description}</p>
      </header>

      <section aria-label={dictionary.leads.total} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-4 sm:p-5" key={stat.label}>
            <p className="text-xs font-medium text-zinc-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/55 p-3 sm:p-4">
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]" method="get">
          <div>
            <label className="sr-only" htmlFor="lead-search">{dictionary.leads.searchLabel}</label>
            <input
              className="w-full rounded-xl border border-zinc-700/90 bg-zinc-950/75 px-4 py-3 text-sm outline-none transition hover:border-zinc-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15"
              defaultValue={q}
              id="lead-search"
              maxLength={120}
              name="q"
              placeholder={dictionary.leads.searchPlaceholder}
              type="search"
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="crm-filter">{dictionary.leads.crmFilterLabel}</label>
            <select
              className="w-full rounded-xl border border-zinc-700/90 bg-zinc-950/75 px-4 py-3 text-sm outline-none transition hover:border-zinc-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15"
              defaultValue={safeCrm}
              id="crm-filter"
              name="crm"
            >
              <option value="">{dictionary.leads.allCrmStates}</option>
              <option value="synced">{dictionary.values.synced}</option>
              <option value="pending">{dictionary.values.pending}</option>
              <option value="failed">{dictionary.values.failed}</option>
            </select>
          </div>
          <button className="rounded-xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white" type="submit">
            {dictionary.leads.filter}
          </button>
        </form>
      </section>

      {filtered.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/35 p-10 text-center sm:p-14">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-500" aria-hidden="true">⌕</div>
          <h2 className="mt-4 text-lg font-semibold">{dictionary.leads.noResultsTitle}</h2>
          <p className="mt-2 text-sm text-zinc-400">{dictionary.leads.noResultsDescription}</p>
        </section>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/65 shadow-xl shadow-black/10 md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-950/35 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                  <tr>
                    <th className="px-5 py-4 font-semibold">{dictionary.leads.person}</th>
                    <th className="px-5 py-4 font-semibold">{dictionary.leads.responsible}</th>
                    <th className="px-5 py-4 font-semibold">{dictionary.leads.typePriority}</th>
                    <th className="px-5 py-4 font-semibold">{dictionary.leads.processing}</th>
                    <th className="px-5 py-4 font-semibold">{dictionary.leads.crm}</th>
                    <th className="px-5 py-4 font-semibold">{dictionary.leads.updatedColumn}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/90">
                  {filtered.map((lead) => (
                    <tr className="group transition hover:bg-zinc-800/35" key={lead.id}>
                      <td className="px-5 py-4">
                        <Link className="font-semibold text-zinc-100 transition group-hover:text-emerald-300" href={`/leads/${lead.id}`}>
                          {displayValue(lead.fullName)}
                        </Link>
                        <p className="mt-1 text-xs text-zinc-500">{displayValue(lead.company)}</p>
                      </td>
                      <td className="max-w-52 px-5 py-4 text-zinc-300">{displayValue(lead.manager)}</td>
                      <td className="px-5 py-4">
                        <p className="text-zinc-200">{localizeValue(lead.leadType, locale)}</p>
                        <p className="mt-1 text-xs text-zinc-500">{localizeValue(lead.priority, locale)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge tone={statusTone(lead.status)}>{localizeValue(lead.status, locale)}</StatusBadge>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge tone={statusTone(lead.crmStatus)}>{localizeValue(lead.crmStatus, locale)}</StatusBadge>
                        <p className="mt-1.5 text-xs text-zinc-500">
                          {lead.bitrixLeadId ? `${dictionary.leads.bitrixLead} ${lead.bitrixLeadId}` : dictionary.leads.notBound}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-zinc-400">
                        {formatDateTime(lead.updatedAt, locale)}
                        <p className="mt-1 text-xs text-zinc-600">{dictionary.common.created}: {formatDateTime(lead.createdAt, locale)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 md:hidden">
            {filtered.map((lead) => (
              <Link
                aria-label={`${dictionary.leads.openLead}: ${displayValue(lead.fullName)}`}
                className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-4 transition hover:border-zinc-700 hover:bg-zinc-900"
                href={`/leads/${lead.id}`}
                key={lead.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-100">{displayValue(lead.fullName)}</p>
                    <p className="mt-1 truncate text-xs text-zinc-500">{displayValue(lead.company)}</p>
                  </div>
                  <StatusBadge tone={statusTone(lead.crmStatus)}>{localizeValue(lead.crmStatus, locale)}</StatusBadge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3 text-xs">
                  <div><p className="text-zinc-600">{dictionary.leads.typePriority}</p><p className="mt-1 text-zinc-300">{localizeValue(lead.leadType, locale)} · {localizeValue(lead.priority, locale)}</p></div>
                  <div><p className="text-zinc-600">{dictionary.leads.responsible}</p><p className="mt-1 truncate text-zinc-300">{displayValue(lead.manager)}</p></div>
                </div>
                <p className="mt-3 text-xs text-zinc-600">{dictionary.common.updated}: {formatDateTime(lead.updatedAt, locale)}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
