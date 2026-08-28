import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";

import { CrmRetryButton } from "@/components/crm-retry-button";
import { StatusBadge, statusTone } from "@/components/status-badge";
import { requireViewer } from "@/modules/auth/session";
import { loadLeadDetail } from "@/modules/leads/ui/data";
import { displayValue, formatDateTime, humanize } from "@/modules/leads/ui/format";

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-1.5 text-sm leading-6 text-zinc-100">{children}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireViewer();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const lead = await loadLeadDetail(id.data);
  if (!lead) notFound();

  return (
    <div className="space-y-6">
      <header>
        <Link className="text-sm text-zinc-400 transition hover:text-emerald-300" href="/leads">← All leads</Link>
        <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm text-zinc-500">Canonical lead · revision {lead.revision}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{displayValue(lead.fullName)}</h1>
            <p className="mt-2 text-zinc-400">{displayValue(lead.company)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={statusTone(lead.status)}>{humanize(lead.status)}</StatusBadge>
            <StatusBadge tone={statusTone(lead.crmStatus)}>{humanize(lead.crmStatus)}</StatusBadge>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">A. Contact</p>
          <h2 className="mt-2 text-xl font-semibold">Extracted fields</h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            <DetailField label="Full name">{displayValue(lead.fullName)}</DetailField>
            <DetailField label="Company">{displayValue(lead.company)}</DetailField>
            <DetailField label="Job title">{displayValue(lead.jobTitle)}</DetailField>
            <DetailField label="Responsible manager">{displayValue(lead.manager)}</DetailField>
            <DetailField label="Phones">{lead.phones.length ? lead.phones.join(", ") : "—"}</DetailField>
            <DetailField label="Emails">{lead.emails.length ? lead.emails.join(", ") : "—"}</DetailField>
            <DetailField label="Lead type">{displayValue(lead.leadType)}</DetailField>
            <DetailField label="Region">{displayValue(lead.region)}</DetailField>
            <DetailField label="Priority">{displayValue(lead.priority)}</DetailField>
            <DetailField label="Product interests">
              {lead.productInterests.length ? lead.productInterests.join(", ") : "—"}
            </DetailField>
          </dl>
        </section>

        <section className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/45 to-zinc-900 p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-indigo-300">B. AI analytical summary</p>
          <h2 className="mt-2 text-xl font-semibold">Derived analysis</h2>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-zinc-200">
            {displayValue(lead.summary)}
          </p>
          <div className="mt-5 border-t border-indigo-500/20 pt-4 text-xs text-zinc-500">
            This derived summary is separate from the original Teams evidence below.
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">C. CRM</p>
        <div className="mt-2 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-xl font-semibold">Bitrix synchronization</h2>
            <dl className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-3">
              <DetailField label="State">{humanize(lead.crmStatus)}</DetailField>
              <DetailField label="Bitrix lead">{lead.bitrixLeadId ?? "—"}</DetailField>
              <DetailField label="Synced revision">{lead.syncedRevision ?? "—"}</DetailField>
              <DetailField label="Last safe error">{displayValue(lead.lastErrorCode)}</DetailField>
              <DetailField label="Synced at">{formatDateTime(lead.syncedAt)}</DetailField>
              <DetailField label="Responsible manager">{displayValue(lead.manager)}</DetailField>
            </dl>
          </div>
          {lead.crmStatus === "succeeded" ? (
            <span className="text-sm text-emerald-300">Current revision is fully synced.</span>
          ) : (
            <CrmRetryButton leadId={lead.id} />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">D. Source evidence</p>
            <h2 className="mt-2 text-xl font-semibold">Original Teams evidence</h2>
          </div>
          <span className="text-sm text-zinc-500">{lead.groups.length} linked conversation group{lead.groups.length === 1 ? "" : "s"}</span>
        </div>

        {lead.groups.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-zinc-700 p-6 text-sm text-zinc-400">No linked source groups are available.</p>
        ) : (
          <div className="mt-6 space-y-5">
            {lead.groups.map((group, groupIndex) => (
              <article className="rounded-xl border border-zinc-800 bg-zinc-950/45 p-4 sm:p-5" key={group.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">Conversation {groupIndex + 1}</h3>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={statusTone(group.extractionState)}>evidence {humanize(group.extractionState)}</StatusBadge>
                    <StatusBadge tone={statusTone(group.canonicalizationState)}>{humanize(group.canonicalizationState)}</StatusBadge>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  {group.messages.map((message, messageIndex) => (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4" key={message.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                        <span className="capitalize">{message.replyToExternalId ? "Teams reply" : `${message.source} original message`}</span>
                        <time>{formatDateTime(message.createdAt)}</time>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                        {displayValue(message.text)}
                      </p>
                      {message.attachments.map((attachment) => (
                        <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4" key={attachment.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{displayValue(attachment.fileName)}</p>
                            <StatusBadge tone={statusTone(attachment.processingState)}>{humanize(attachment.processingState)}</StatusBadge>
                          </div>
                          {attachment.transcript ? (
                            <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Transcription</p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{attachment.transcript}</p>
                            </div>
                          ) : null}
                          {attachment.ocr ? (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">OCR / visible text</p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{attachment.ocr}</p>
                            </div>
                          ) : null}
                          {attachment.canPreview ? (
                            <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                              <Image
                                alt={`Source image ${messageIndex + 1}`}
                                className="h-auto w-full object-contain"
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
        <section className="rounded-2xl border border-red-900/50 bg-red-950/20 p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-red-300">Evidence conflicts</p>
          <ul className="mt-4 space-y-3 text-sm text-zinc-200">
            {lead.conflicts.map((conflict, index) => (
              <li className="rounded-lg border border-red-900/40 p-3" key={`${conflict.fieldName}-${index}`}>
                <span className="font-semibold">{humanize(conflict.fieldName)}:</span>{" "}
                {displayValue(conflict.evidenceText)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
