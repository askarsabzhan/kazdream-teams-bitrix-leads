import { StatusBadge, statusTone } from "@/components/status-badge";
import { getI18n } from "@/i18n/server";
import { loadAdminDashboard } from "@/modules/admin/data";
import { requireAdmin } from "@/modules/auth/session";
import { displayValue, localizeValue } from "@/modules/leads/ui/format";

const integrationDisplayNames: Record<string, string> = {
  "Microsoft Graph": "Microsoft Teams",
  OpenAI: "OpenAI",
  Supabase: "Supabase",
  Bitrix: "Bitrix24",
};

export default async function AdminPage() {
  await requireAdmin();
  const { dictionary, locale } = await getI18n();
  const dashboard = await loadAdminDashboard();

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">{dictionary.admin.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{dictionary.admin.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{dictionary.admin.description}</p>
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold">{dictionary.admin.integrationHealth}</h2>
          <p className="mt-2 text-sm text-zinc-500">{dictionary.admin.integrationHint}</p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dashboard.health.map((integration) => (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/45 p-4" key={integration.name}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">{integrationDisplayNames[integration.name] ?? integration.name}</p>
                  <p className="mt-1 text-xs text-zinc-600">{dictionary.admin.server}</p>
                </div>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${integration.configured ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden="true" />
              </div>
              <div className="mt-4">
                <StatusBadge tone={integration.configured ? "success" : "warning"}>
                  {integration.configured ? dictionary.admin.configured : dictionary.admin.unconfigured}
                </StatusBadge>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
          <h2 className="text-xl font-semibold">{dictionary.admin.currentCampaign}</h2>
          {dashboard.campaign ? (
            <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-6 text-sm">
              <div><dt className="text-xs text-zinc-500">{dictionary.admin.campaign}</dt><dd className="mt-1.5 font-medium text-zinc-200">{dashboard.campaign.name}</dd></div>
              <div><dt className="text-xs text-zinc-500">{dictionary.admin.campaignStatus}</dt><dd className="mt-1.5"><StatusBadge tone={dashboard.campaign.active ? "success" : "neutral"}>{localizeValue(dashboard.campaign.active ? "active" : "inactive", locale)}</StatusBadge></dd></div>
              <div><dt className="text-xs text-zinc-500">{dictionary.admin.source}</dt><dd className="mt-1.5 font-medium text-zinc-200">{localizeValue(dashboard.campaign.source, locale)}</dd></div>
              <div><dt className="text-xs text-zinc-500">{dictionary.admin.bitrixEnum}</dt><dd className="mt-1.5 font-medium text-zinc-200">{dashboard.campaign.exhibitionBitrixId ?? "—"}</dd></div>
            </dl>
          ) : <p className="mt-5 text-sm text-zinc-400">{dictionary.admin.campaignMissing}</p>}
          <p className="mt-6 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">{dictionary.admin.campaignHint}</p>
        </section>

        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
          <h2 className="text-xl font-semibold">{dictionary.admin.queueStatus}</h2>
          <p className="mt-2 text-sm text-zinc-500">{dictionary.admin.queueHint}</p>
          {dashboard.queues.length ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {dashboard.queues.map((queue) => (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/35 px-4 py-3" key={`${queue.name}-${queue.status}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-200">{localizeValue(queue.name, locale)}</p>
                    <div className="mt-1.5"><StatusBadge tone={statusTone(queue.status)}>{localizeValue(queue.status, locale)}</StatusBadge></div>
                  </div>
                  <span className="text-2xl font-semibold tracking-tight text-zinc-100">{queue.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="mt-5 text-sm text-zinc-400">{dictionary.admin.queuesEmpty}</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{dictionary.admin.managerMappings}</h2>
        <p className="mt-2 text-sm text-zinc-500">{dictionary.admin.managerMappingsHint}</p>
        {dashboard.managerMappings.length ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-zinc-800 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                <tr><th className="pb-3 font-semibold">{dictionary.admin.teamsIdentity}</th><th className="pb-3 font-semibold">{dictionary.admin.bitrixUser}</th><th className="pb-3 font-semibold">{dictionary.admin.mappingState}</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/90">
                {dashboard.managerMappings.map((mapping, index) => (
                  <tr key={`${mapping.bitrixUserId}-${index}`}>
                    <td className="py-3.5 pr-4">{displayValue(mapping.teamsIdentity)}</td>
                    <td className="py-3.5 pr-4 text-zinc-300">{mapping.bitrixUserId}</td>
                    <td className="py-3.5"><StatusBadge tone={mapping.active ? "success" : "neutral"}>{localizeValue(mapping.active ? "active" : "inactive", locale)}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mt-5 text-sm text-zinc-400">{dictionary.admin.mappingsEmpty}</p>}
      </section>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{dictionary.admin.referenceMappings}</h2>
        <p className="mt-2 text-sm text-zinc-500">{dictionary.admin.referenceMappingsHint}</p>
        {dashboard.referenceMappings.length ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-zinc-800 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                <tr><th className="pb-3 font-semibold">{dictionary.admin.field}</th><th className="pb-3 font-semibold">{dictionary.admin.canonicalKey}</th><th className="pb-3 font-semibold">{dictionary.admin.display}</th><th className="pb-3 font-semibold">{dictionary.admin.bitrixEnum}</th><th className="pb-3 font-semibold">{dictionary.admin.mappingState}</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/90">
                {dashboard.referenceMappings.map((mapping) => (
                  <tr key={`${mapping.fieldType}-${mapping.canonicalKey}`}>
                    <td className="py-3.5 pr-4">{localizeValue(mapping.fieldType, locale)}</td>
                    <td className="py-3.5 pr-4 font-mono text-xs text-zinc-500">{mapping.canonicalKey}</td>
                    <td className="py-3.5 pr-4">{mapping.displayLabel}</td>
                    <td className="py-3.5 pr-4 text-zinc-300">{mapping.bitrixValueId}</td>
                    <td className="py-3.5"><StatusBadge tone={statusTone(mapping.active ? "configured" : "unconfigured")}>{localizeValue(mapping.active ? "active" : "inactive", locale)}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mt-5 text-sm text-zinc-400">{dictionary.admin.referenceEmpty}</p>}
      </section>
    </div>
  );
}
