"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RetryLabels = {
  alreadySynced: string;
  failed: string;
  pending: string;
  recorded: string;
  retry: string;
};

export function CrmRetryButton({ leadId, labels }: { leadId: string; labels: RetryLabels }) {
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
      setMessage(result.outcome === "already_succeeded" ? labels.alreadySynced : labels.recorded);
      router.refresh();
    } catch {
      setMessage(labels.failed);
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
        {pending ? labels.pending : labels.retry}
      </button>
      {message ? <span className="text-xs text-zinc-400" role="status">{message}</span> : null}
    </div>
  );
}
