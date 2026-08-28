import type { ReactNode } from "react";

const toneClasses = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  danger: "border-red-500/30 bg-red-500/10 text-red-200",
  neutral: "border-zinc-700 bg-zinc-800 text-zinc-300",
};

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(value: string): keyof typeof toneClasses {
  if (["succeeded", "synced", "processed", "linked", "configured"].includes(value)) return "success";
  if (["retryable_failed", "permanent_failed", "failed", "blocked"].includes(value)) return "danger";
  if (["pending", "processing", "crm_pending", "validated", "unconfigured"].includes(value)) return "warning";
  return "neutral";
}
