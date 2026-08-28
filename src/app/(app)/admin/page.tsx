import { StatusBadge, statusTone } from "@/components/status-badge";
import { loadAdminDashboard } from "@/modules/admin/data";
import { requireAdmin } from "@/modules/auth/session";
import { displayValue, humanize } from "@/modules/leads/ui/format";

export default async function AdminPage() {
  await requireAdmin();
  const dashboard = await loadAdminDashboard();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-emerald-300">Admin · read only</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">System overview</h1>
        <p className="mt-2 text-sm text-zinc-400">Safe configuration and durable queue state. No provider calls are made on load.</p>
      </header>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-xl font-semibold">Integration health</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dashboard.health.map((integration) => (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4" key={integration.name}>
              <p className="text-sm font-medium">{integration.name}</p>
              <div className="mt-3">
                <StatusBadge tone={integration.configured ? "success" : "warning"}>
                  {integration.configured ? "configured" : "unconfigured"}
                </StatusBadge>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold">Test campaign</h2>
          {dashboard.campaign ? (
            <dl className="mt-5 grid grid-cols-2 gap-5 text-sm">
              <div><dt className="text-zinc-500">Campaign</dt><dd className="mt-1 font-medium">{dashboard.campaign.name}</dd></div>
              <div><dt className="text-zinc-500">Status</dt><dd className="mt-1"><StatusBadge tone={dashboard.campaign.active ? "success" : "neutral"}>{dashboard.campaign.active ? "active" : "inactive"}</StatusBadge></dd></div>
              <div><dt className="text-zinc-500">Source</dt><dd className="mt-1 font-medium">{displayValue(dashboard.campaign.source)}</dd></div>
              <div><dt className="text-zinc-500">Bitrix enum</dt><dd className="mt-1 font-medium">{dashboard.campaign.exhibitionBitrixId ?? "—"}</dd></div>
            </dl>
          ) : <p className="mt-4 text-sm text-zinc-400">MVP campaign is not configured.</p>}
          <p className="mt-5 border-t border-zinc-800 pt-4 text-xs text-zinc-500">Current MVP / evaluator configuration.</p>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold">Queue status</h2>
          {dashboard.queues.length ? (
            <div className="mt-5 space-y-3">
              {dashboard.queues.map((queue) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-2" key={`${queue.name}-${queue.status}`}>
                  <div><p className="text-sm font-medium">{humanize(queue.name)}</p><p className="text-xs text-zinc-500">{humanize(queue.status)}</p></div>
                  <span className="text-lg font-semibold">{queue.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-zinc-400">All queues are empty.</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-xl font-semibold">Manager mappings</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500"><tr><th className="pb-3 font-medium">Teams identity</th><th className="pb-3 font-medium">Bitrix user</th><th className="pb-3 font-medium">State</th></tr></thead>
            <tbody className="divide-y divide-zinc-800">
              {dashboard.managerMappings.map((mapping, index) => (
                <tr key={`${mapping.bitrixUserId}-${index}`}><td className="py-3">{displayValue(mapping.teamsIdentity)}</td><td className="py-3">{mapping.bitrixUserId}</td><td className="py-3"><StatusBadge tone={mapping.active ? "success" : "neutral"}>{mapping.active ? "active" : "inactive"}</StatusBadge></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-xl font-semibold">Reference mappings</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500"><tr><th className="pb-3 font-medium">Field</th><th className="pb-3 font-medium">Canonical key</th><th className="pb-3 font-medium">Display</th><th className="pb-3 font-medium">Bitrix enum</th><th className="pb-3 font-medium">State</th></tr></thead>
            <tbody className="divide-y divide-zinc-800">
              {dashboard.referenceMappings.map((mapping) => (
                <tr key={`${mapping.fieldType}-${mapping.canonicalKey}`}><td className="py-3 capitalize">{humanize(mapping.fieldType)}</td><td className="py-3 text-zinc-400">{mapping.canonicalKey}</td><td className="py-3">{mapping.displayLabel}</td><td className="py-3">{mapping.bitrixValueId}</td><td className="py-3"><StatusBadge tone={statusTone(mapping.active ? "configured" : "unconfigured")}>{mapping.active ? "active" : "inactive"}</StatusBadge></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
