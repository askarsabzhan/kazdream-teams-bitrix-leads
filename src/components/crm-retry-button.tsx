"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CrmRetryButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/retry-crm`, { method: "POST" });
      if (!response.ok && response.status !== 409) throw new Error("request failed");
      const result = (await response.json()) as { outcome?: string };
      setMessage(result.outcome === "already_succeeded" ? "Already fully synced." : "Retry request recorded.");
      router.refresh();
    } catch {
      setMessage("Retry could not be requested.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        onClick={retry}
        type="button"
      >
        {pending ? "Requesting…" : "Retry CRM"}
      </button>
      {message ? <span className="text-xs text-zinc-400" role="status">{message}</span> : null}
    </div>
  );
}
