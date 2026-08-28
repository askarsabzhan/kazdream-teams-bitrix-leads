import Link from "next/link";

import { StatusBadge, statusTone } from "@/components/status-badge";
import { requireViewer } from "@/modules/auth/session";
import { loadLeads } from "@/modules/leads/ui/data";
import {
  crmFilterStatus,
  displayValue,
  formatDateTime,
  humanize,
} from "@/modules/leads/ui/format";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; crm?: string }>;
}) {
  await requireViewer();
  const leads = await loadLeads();
  const { q = "", crm = "" } = await searchParams;
  const safeQuery = q.trim().slice(0, 120).toLocaleLowerCase();
  const safeCrm = ["synced", "pending", "failed"].includes(crm) ? crm : "";
  const filtered = leads.filter((lead) => {
    const searchable = `${lead.fullName ?? ""} ${lead.company ?? ""}`.toLocaleLowerCase();
    return (!safeQuery || searchable.includes(safeQuery)) &&
      (!safeCrm || crmFilterStatus(lead.crmStatus) === safeCrm);
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-emerald-300">Canonical workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-2 text-sm text-zinc-400">{leads.length} current canonical lead{leads.length === 1 ? "" : "s"}</p>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" method="get">
          <input
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
            defaultValue={q}
            maxLength={120}
            name="q"
            placeholder="Search person or company"
          />
          <select
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
            defaultValue={safeCrm}
            name="crm"
          >
            <option value="">All CRM states</option>
            <option value="synced">Synced</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
          <button className="rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950" type="submit">
            Filter
          </button>
        </form>
      </header>

      {filtered.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center">
          <h2 className="text-lg font-semibold">No matching leads</h2>
          <p className="mt-2 text-sm text-zinc-400">Adjust the search or CRM status filter.</p>
        </section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-4 font-medium">Contact</th>
                  <th className="px-5 py-4 font-medium">Manager</th>
                  <th className="px-5 py-4 font-medium">Type / priority</th>
                  <th className="px-5 py-4 font-medium">Processing</th>
                  <th className="px-5 py-4 font-medium">Bitrix sync</th>
                  <th className="px-5 py-4 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filtered.map((lead) => (
                  <tr className="transition hover:bg-zinc-800/35" key={lead.id}>
                    <td className="px-5 py-4">
                      <Link className="font-semibold text-zinc-100 hover:text-emerald-300" href={`/leads/${lead.id}`}>
                        {displayValue(lead.fullName)}
                      </Link>
                      <p className="mt-1 text-xs text-zinc-500">{displayValue(lead.company)}</p>
                    </td>
                    <td className="px-5 py-4 text-zinc-300">{displayValue(lead.manager)}</td>
                    <td className="px-5 py-4">
                      <p className="capitalize text-zinc-200">{humanize(lead.leadType)}</p>
                      <p className="mt-1 text-xs capitalize text-zinc-500">{humanize(lead.priority)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge tone={statusTone(lead.status)}>{humanize(lead.status)}</StatusBadge>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge tone={statusTone(lead.crmStatus)}>{humanize(lead.crmStatus)}</StatusBadge>
                      <p className="mt-1.5 text-xs text-zinc-500">{lead.bitrixLeadId ? `Lead ${lead.bitrixLeadId}` : "Not bound"}</p>
                    </td>
                    <td className="px-5 py-4 text-zinc-400">
                      {formatDateTime(lead.updatedAt)}
                      <p className="mt-1 text-xs text-zinc-600">Created {formatDateTime(lead.createdAt)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
