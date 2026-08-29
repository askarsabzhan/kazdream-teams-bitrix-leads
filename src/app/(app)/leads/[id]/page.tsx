import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";

import { CrmRetryButton } from "@/components/crm-retry-button";
import { StatusBadge, statusTone } from "@/components/status-badge";
import { getI18n } from "@/i18n/server";
import { requireViewer } from "@/modules/auth/session";
import { loadLeadDetail } from "@/modules/leads/ui/data";
import {
  displayValue,
  formatDateTime,
  localizeValue,
} from "@/modules/leads/ui/format";

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</dt>
      <dd className="mt-2 break-words text-sm leading-6 text-zinc-100">{children}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireViewer();
  const { dictionary, locale } = await getI18n();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const lead = await loadLeadDetail(id.data);
  if (!lead) notFound();

  return (
    <div className="space-y-7">
      <header>
        <Link className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-emerald-300" href="/leads">
          <span aria-hidden="true">←</span> {dictionary.detail.back}
        </Link>
        <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              {dictionary.detail.canonicalLead} · {dictionary.common.revision} {lead.revision}
            </p>
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{displayValue(lead.fullName)}</h1>
            <p className="mt-2 text-base text-zinc-400">{displayValue(lead.company)}</p>
            <p className="mt-2 text-sm text-zinc-500">{dictionary.detail.responsible}: <span className="text-zinc-300">{displayValue(lead.manager)}</span></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={statusTone(lead.leadType)}>{localizeValue(lead.leadType, locale)}</StatusBadge>
            <StatusBadge tone={statusTone(lead.priority ?? "")}>{localizeValue(lead.priority, locale)}</StatusBadge>
            <StatusBadge tone={statusTone(lead.crmStatus)}>{localizeValue(lead.crmStatus, locale)}</StatusBadge>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{dictionary.detail.contact}</p>
          <h2 className="mt-2 text-xl font-semibold">{dictionary.detail.contactDescription}</h2>
          <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <DetailField label={dictionary.detail.fullName}>{displayValue(lead.fullName)}</DetailField>
            <DetailField label={dictionary.detail.company}>{displayValue(lead.company)}</DetailField>
            <DetailField label={dictionary.detail.jobTitle}>{displayValue(lead.jobTitle)}</DetailField>
            <DetailField label={dictionary.detail.responsible}>{displayValue(lead.manager)}</DetailField>
            <DetailField label={dictionary.detail.phones}>{lead.phones.length ? lead.phones.join(", ") : "—"}</DetailField>
            <DetailField label={dictionary.detail.emails}>{lead.emails.length ? lead.emails.join(", ") : "—"}</DetailField>
          </dl>
        </section>

        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">{dictionary.detail.classification}</p>
          <dl className="mt-6 grid gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <DetailField label={dictionary.detail.leadType}>{localizeValue(lead.leadType, locale)}</DetailField>
            <DetailField label={dictionary.detail.priority}>{localizeValue(lead.priority, locale)}</DetailField>
            <DetailField label={dictionary.detail.region}>{localizeValue(lead.region, locale)}</DetailField>
            <DetailField label={dictionary.detail.productInterests}>
              {lead.productInterests.length
                ? lead.productInterests.map((interest) => localizeValue(interest, locale)).join(", ")
                : "—"}
            </DetailField>
          </dl>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-indigo-400/20 bg-indigo-950/20">
        <div className="border-b border-indigo-400/15 bg-indigo-400/5 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/10 text-sm font-bold text-indigo-200" aria-hidden="true">AI</span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">{dictionary.detail.aiSummary}</p>
              <h2 className="mt-1 font-semibold text-zinc-100">{dictionary.detail.aiSummaryTitle}</h2>
            </div>
          </div>
        </div>
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{displayValue(lead.summary)}</p>
          <p className="mt-5 border-t border-indigo-400/15 pt-4 text-xs leading-5 text-indigo-200/60">{dictionary.detail.aiSummaryHint}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/65 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{dictionary.detail.crmSection}</p>
        <div className="mt-2 flex flex-col justify-between gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{dictionary.detail.crmTitle}</h2>
            <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
              <DetailField label={dictionary.detail.state}>{localizeValue(lead.crmStatus, locale)}</DetailField>
              <DetailField label={dictionary.detail.bitrixLead}>{lead.bitrixLeadId ?? "—"}</DetailField>
              <DetailField label={dictionary.detail.syncedRevision}>{lead.syncedRevision ?? "—"}</DetailField>
              <DetailField label={dictionary.detail.lastSafeError}>{displayValue(lead.lastErrorCode)}</DetailField>
              <DetailField label={dictionary.detail.syncedAt}>{formatDateTime(lead.syncedAt, locale)}</DetailField>
              <DetailField label={dictionary.detail.responsible}>{displayValue(lead.manager)}</DetailField>
            </dl>
          </div>
          <div className="shrink-0 xl:pt-1">
            {lead.crmStatus === "succeeded" ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-200">
                {dictionary.detail.fullySynced}
              </div>
            ) : (
              <CrmRetryButton
                leadId={lead.id}
                labels={{
                  alreadySynced: dictionary.detail.alreadySynced,
                  failed: dictionary.detail.retryFailed,
                  pending: dictionary.detail.requestingRetry,
                  recorded: dictionary.detail.retryRecorded,
                  retry: dictionary.detail.retryCrm,
                }}
              />
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/55 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{dictionary.detail.sourceEvidence}</p>
            <h2 className="mt-2 text-xl font-semibold">{dictionary.detail.sourceTitle}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{dictionary.detail.sourceDescription}</p>
          </div>
          <span className="shrink-0 text-sm text-zinc-500">{dictionary.detail.linkedGroups}: {lead.groups.length}</span>
        </div>

        {lead.groups.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-zinc-700 p-6 text-sm text-zinc-400">{dictionary.detail.noGroups}</p>
        ) : (
          <div className="mt-7 space-y-6">
            {lead.groups.map((group, groupIndex) => (
              <article className="rounded-2xl border border-zinc-800 bg-zinc-950/35 p-4 sm:p-5" key={group.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">{dictionary.detail.conversation} {groupIndex + 1}</h3>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={statusTone(group.extractionState)}>{dictionary.detail.evidenceStatus}: {localizeValue(group.extractionState, locale)}</StatusBadge>
                    <StatusBadge tone={statusTone(group.canonicalizationState)}>{localizeValue(group.canonicalizationState, locale)}</StatusBadge>
                  </div>
                </div>
                <div className="relative mt-5 space-y-4 border-l border-zinc-800 pl-4 sm:pl-6">
                  {group.messages.map((message, messageIndex) => (
                    <div className="relative rounded-xl border border-zinc-800 bg-zinc-900/75 p-4" key={message.id}>
                      <span className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 bg-emerald-400 sm:-left-[29px]" aria-hidden="true" />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-400">{message.replyToExternalId ? dictionary.detail.reply : dictionary.detail.originalTeamsMessage}</span>
                        <time dateTime={message.createdAt}>{formatDateTime(message.createdAt, locale)}</time>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{displayValue(message.text)}</p>
                      {message.attachments.map((attachment) => (
                        <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4" key={attachment.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="break-all text-sm font-medium">{displayValue(attachment.fileName)}</p>
                            <StatusBadge tone={statusTone(attachment.processingState)}>{localizeValue(attachment.processingState, locale)}</StatusBadge>
                          </div>
                          {attachment.transcript ? (
                            <div className="rounded-xl border border-sky-400/15 bg-sky-950/20 p-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-300">{dictionary.detail.transcription}</p>
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{attachment.transcript}</p>
                            </div>
                          ) : null}
                          {attachment.ocr ? (
                            <div className="rounded-xl border border-amber-400/15 bg-amber-950/20 p-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-300">{dictionary.detail.ocr}</p>
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{attachment.ocr}</p>
                            </div>
                          ) : null}
                          {attachment.canPreview ? (
                            <div className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">
                              <Image
                                alt={`${dictionary.detail.sourceImage} ${messageIndex + 1}`}
                                className="h-auto max-h-[720px] w-full object-contain"
                                height={720}
                                src={`/api/attachments/${attachment.id}/preview`}
                                unoptimized
                                width={1280}
                              />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {lead.conflicts.length ? (
        <section className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-300">{dictionary.detail.conflicts}</p>
          <ul className="mt-4 space-y-3 text-sm text-zinc-200">
            {lead.conflicts.map((conflict, index) => (
              <li className="rounded-xl border border-rose-900/40 p-3" key={`${conflict.fieldName}-${index}`}>
                <span className="font-semibold">{localizeValue(conflict.fieldName, locale)}:</span>{" "}
                {displayValue(conflict.evidenceText)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
