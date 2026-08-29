import type { ReactNode } from "react";

const toneClasses = {
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  danger: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  neutral: "border-zinc-700/90 bg-zinc-800/80 text-zinc-300",
};

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(value: string): keyof typeof toneClasses {
  const normalized = value.trim().toLocaleLowerCase();
  if (["succeeded", "synced", "processed", "linked", "configured", "active", "fetched", "completed", "ready", "eligible", "extracted", "canonicalized", "sent", "accepted"].includes(normalized)) return "success";
  if (["retryable_failed", "permanent_failed", "failed", "blocked", "conflicted", "identity_conflict", "rejected", "high"].includes(normalized)) return "danger";
  if (["pending", "processing", "crm_pending", "validated", "unconfigured", "assembling", "evaluating", "extracting", "reconciling", "downloading", "retrying", "medium", "partner"].includes(normalized)) return "warning";
  return "neutral";
}
