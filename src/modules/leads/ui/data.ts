import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalLeadPayloadSchema } from "@/modules/leads/canonicalization/schema";
import {
  groupEvidenceSources,
  type EvidenceSource,
} from "@/modules/leads/ui/evidence-sources";

export type LeadListItem = {
  id: string;
  fullName: string | null;
  company: string | null;
  manager: string | null;
  leadType: string;
  priority: string | null;
  status: string;
  crmStatus: string;
  bitrixLeadId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadMessage = {
  id: string;
  externalId: string;
  replyToExternalId: string | null;
  source: string;
  createdAt: string;
  groupingState: string;
  groupedAt: string | null;
  text: string | null;
  attachments: Array<{
    id: string;
    fileName: string | null;
    mimeType: string | null;
    fetchState: string;
    processingState: string;
    processedAt: string | null;
    transcript: string | null;
    ocr: string | null;
    canPreview: boolean;
  }>;
};

export type LeadDetail = {
  id: string;
  fullName: string | null;
  company: string | null;
  jobTitle: string | null;
  phones: string[];
  emails: string[];
  leadType: string;
  region: string | null;
  priority: string | null;
  productInterests: string[];
  summary: string | null;
  summaryState: string;
  status: string;
  crmStatus: string;
  bitrixLeadId: number | null;
  syncedRevision: number | null;
  revision: number;
  lastErrorCode: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  manager: string | null;
  evidenceSources: Record<string, EvidenceSource[]>;
  groups: Array<{
    id: string;
    status: string;
    extractionState: string;
    canonicalizationState: string;
    createdAt: string;
    extractionCompletedAt: string | null;
    canonicalizedAt: string | null;
    messages: LeadMessage[];
  }>;
  conflicts: Array<{ fieldName: string; evidenceText: string | null }>;
};

type ManagerLabelRow = {
  lead_id: string;
  manager_label: string | null;
};

async function loadManagerLabels(leadIds: string[]): Promise<Map<string, string | null>> {
  if (leadIds.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc("load_lead_manager_labels", { p_lead_ids: leadIds });
  if (result.error) throw new Error("Unable to load responsible managers.");
  return new Map(
    ((result.data ?? []) as ManagerLabelRow[]).map((row) => [row.lead_id, row.manager_label]),
  );
}

export async function loadLeads(): Promise<LeadListItem[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase
    .from("leads")
    .select(
      "id, full_name, company_name, lead_type, priority_key, status, crm_status, bitrix_lead_id, created_at, updated_at",
    )
    .order("updated_at", { ascending: false });

  if (result.error) throw new Error("Unable to load leads.");
  const rows = result.data ?? [];
  const labels = await loadManagerLabels(rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    company: row.company_name,
    manager: labels.get(row.id) ?? null,
    leadType: row.lead_type,
    priority: row.priority_key,
    status: row.status,
    crmStatus: row.crm_status,
    bitrixLeadId: row.bitrix_lead_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function contactValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && "value" in item && typeof item.value === "string") {
      return [item.value];
    }
    return [];
  });
}

export async function loadLeadDetail(id: string): Promise<LeadDetail | null> {
  const supabase = await createSupabaseServerClient();
  const leadResult = await supabase
    .from("leads")
    .select(
      "id, full_name, company_name, job_title, phones, emails, lead_type, region_key, priority_key, product_interest_keys, summary_ru, summary_state, status, crm_status, bitrix_lead_id, crm_synced_revision, revision, crm_last_error_code, crm_synced_at, canonical_payload, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (leadResult.error) throw new Error("Unable to load lead details.");
  if (!leadResult.data) return null;
  const lead = leadResult.data;

  const groupResult = await supabase
    .from("lead_groups")
    .select("id, status, extraction_state, canonicalization_state, created_at, extraction_revision, extraction_completed_at, canonicalized_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });
  if (groupResult.error) throw new Error("Unable to load source groups.");
  const groupRows = groupResult.data ?? [];
  const groupIds = groupRows.map((group) => group.id);

  const memberships = groupIds.length
    ? await supabase
        .from("lead_group_messages")
        .select("lead_group_id, teams_message_id")
        .in("lead_group_id", groupIds)
    : { data: [], error: null };
  if (memberships.error) throw new Error("Unable to load source memberships.");
  const messageIds = [...new Set((memberships.data ?? []).map((row) => row.teams_message_id))];

  const messagesResult = messageIds.length
    ? await supabase
        .from("teams_messages")
        .select(
          "id, external_message_id, reply_to_external_message_id, source, source_created_at, typed_text, grouping_state, grouped_at",
        )
        .in("id", messageIds)
        .order("source_created_at", { ascending: true })
    : { data: [], error: null };
  if (messagesResult.error) throw new Error("Unable to load source messages.");

  const attachmentsResult = messageIds.length
    ? await supabase
        .from("attachments")
        .select(
          "id, teams_message_id, file_name, mime_type, fetch_state, processing_state, transcript_text, ocr_text, storage_path, is_current, processed_at",
        )
        .in("teams_message_id", messageIds)
        .eq("is_current", true)
    : { data: [], error: null };
  if (attachmentsResult.error) throw new Error("Unable to load source attachments.");

  const fieldEvidenceResult = groupIds.length
    ? await supabase
        .from("field_evidence")
        .select("lead_group_id, extraction_revision, field_name, method")
        .in("lead_group_id", groupIds)
        .eq("validation_status", "accepted")
    : { data: [], error: null };
  if (fieldEvidenceResult.error) throw new Error("Unable to load field provenance.");

  const conflictsResult = await supabase
    .from("field_evidence")
    .select("field_name, evidence_text")
    .eq("lead_id", id)
    .eq("validation_status", "conflicted")
    .order("created_at", { ascending: true });
  if (conflictsResult.error) throw new Error("Unable to load evidence conflicts.");

  const attachmentsByMessage = new Map<string, LeadMessage["attachments"]>();
  for (const attachment of attachmentsResult.data ?? []) {
    const current = attachmentsByMessage.get(attachment.teams_message_id) ?? [];
    current.push({
      id: attachment.id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      fetchState: attachment.fetch_state,
      processingState: attachment.processing_state,
      processedAt: attachment.processed_at,
      transcript: attachment.transcript_text,
      ocr: attachment.ocr_text,
      canPreview:
        attachment.fetch_state === "fetched" &&
        Boolean(attachment.storage_path) &&
        Boolean(attachment.mime_type?.startsWith("image/")),
    });
    attachmentsByMessage.set(attachment.teams_message_id, current);
  }

  const messagesById = new Map(
    (messagesResult.data ?? []).map((message) => [
      message.id,
      {
        id: message.id,
        externalId: message.external_message_id,
        replyToExternalId: message.reply_to_external_message_id,
        source: message.source,
        createdAt: message.source_created_at,
        groupingState: message.grouping_state,
        groupedAt: message.grouped_at,
        text: message.typed_text,
        attachments: attachmentsByMessage.get(message.id) ?? [],
      } satisfies LeadMessage,
    ]),
  );

  const messageIdsByGroup = new Map<string, string[]>();
  for (const membership of memberships.data ?? []) {
    const current = messageIdsByGroup.get(membership.lead_group_id) ?? [];
    current.push(membership.teams_message_id);
    messageIdsByGroup.set(membership.lead_group_id, current);
  }

  const canonical = canonicalLeadPayloadSchema.safeParse(lead.canonical_payload);
  const labels = await loadManagerLabels([id]);
  const currentExtractionRevisions = new Map(
    groupRows.map((group) => [group.id, group.extraction_revision]),
  );
  const evidenceSources = groupEvidenceSources(
    (fieldEvidenceResult.data ?? []).flatMap((row) =>
      row.lead_group_id &&
      row.extraction_revision === currentExtractionRevisions.get(row.lead_group_id)
        ? [{ fieldName: row.field_name, method: row.method }]
        : [],
    ),
  );

  return {
    id: lead.id,
    fullName: canonical.success ? canonical.data.person.fullName.value : lead.full_name,
    company: canonical.success ? canonical.data.person.company.value : lead.company_name,
    jobTitle: canonical.success ? canonical.data.person.jobTitle.value : lead.job_title,
    phones: canonical.success ? canonical.data.phones.map((phone) => phone.value) : contactValues(lead.phones),
    emails: canonical.success ? canonical.data.emails.map((email) => email.value) : contactValues(lead.emails),
    leadType: canonical.success ? canonical.data.leadType.value : lead.lead_type,
    region: canonical.success ? canonical.data.region.value : lead.region_key,
    priority: canonical.success ? canonical.data.priority.value : lead.priority_key,
    productInterests: canonical.success
      ? canonical.data.productInterests.map((interest) => interest.value)
      : lead.product_interest_keys,
    summary: lead.summary_ru,
    summaryState: lead.summary_state,
    status: lead.status,
    crmStatus: lead.crm_status,
    bitrixLeadId: lead.bitrix_lead_id,
    syncedRevision: lead.crm_synced_revision,
    revision: lead.revision,
    lastErrorCode: lead.crm_last_error_code,
    syncedAt: lead.crm_synced_at,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
    manager: labels.get(id) ?? null,
    evidenceSources,
    groups: groupRows.map((group) => ({
      id: group.id,
      status: group.status,
      extractionState: group.extraction_state,
      canonicalizationState: group.canonicalization_state,
      createdAt: group.created_at,
      extractionCompletedAt: group.extraction_completed_at,
      canonicalizedAt: group.canonicalized_at,
      messages: (messageIdsByGroup.get(group.id) ?? []).flatMap((messageId) => {
        const message = messagesById.get(messageId);
        return message ? [message] : [];
      }),
    })),
    conflicts: (conflictsResult.data ?? []).map((conflict) => ({
      fieldName: conflict.field_name,
      evidenceText: conflict.evidence_text,
    })),
  };
}
