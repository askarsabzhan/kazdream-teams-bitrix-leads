import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ConversationGroupingRepository,
  GroupableAttachmentEvidence,
  GroupableMessage,
  GroupingDecision,
  GroupingPersistenceSummary,
} from "./types";
import { ConversationGroupingError } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  return value;
}

function requiredInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  return Number(value);
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  return value;
}

function parseAttachment(value: unknown): GroupableAttachmentEvidence {
  if (!isRecord(value)) {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  const operationValue = value.operation;
  const operation =
    operationValue === "transcription" || operationValue === "image_text"
      ? operationValue
      : null;
  return {
    fetchState: requiredString(value.fetch_state),
    processingState: requiredString(value.processing_state),
    operation,
    transcriptText: nullableString(value.transcript_text),
    ocrText: nullableString(value.ocr_text),
  };
}

function parseMessage(value: unknown): GroupableMessage {
  if (!isRecord(value)) {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  if (!Array.isArray(value.attachments)) {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  const fingerprint = requiredString(value.input_fingerprint);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new ConversationGroupingError("INVALID_GROUPING_SOURCE");
  }
  return {
    id: requiredString(value.message_id),
    campaignId: nullableString(value.campaign_id),
    source: requiredString(value.source),
    tenantId: requiredString(value.tenant_id),
    teamId: requiredString(value.team_id),
    channelId: requiredString(value.channel_id),
    externalMessageId: requiredString(value.external_message_id),
    authorTeamsUserId: nullableString(value.author_teams_user_id),
    replyToExternalMessageId: nullableString(
      value.reply_to_external_message_id,
    ),
    sourceCreatedAt: requiredString(value.source_created_at),
    bodyContent: nullableString(value.body_content),
    contentRevision: requiredInteger(value.content_revision),
    inputFingerprint: fingerprint,
    evidenceReady: requiredBoolean(value.evidence_ready),
    isBot: requiredBoolean(value.is_bot),
    isServiceMessage: requiredBoolean(value.is_service_message),
    attachments: value.attachments.map(parseAttachment),
    currentGroupingState: requiredString(value.current_grouping_state),
    currentAlgorithmVersion: nullableString(value.current_algorithm_version),
    currentGroupingFingerprint: nullableString(
      value.current_grouping_fingerprint,
    ),
    currentGroupingReason: nullableString(value.current_grouping_reason),
    currentGroupKey: nullableString(value.current_group_key),
  };
}

function databaseCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/i.test(value)
    ? value.toUpperCase()
    : "GROUPING_DATABASE_ERROR";
}

function parseSummary(value: unknown): GroupingPersistenceSummary {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new ConversationGroupingError("INVALID_GROUPING_RESULT");
  }
  const row = value[0];
  return {
    groupsCreated: requiredInteger(row.groups_created),
    membershipsCreated: requiredInteger(row.memberships_created),
    membershipsRemoved: requiredInteger(row.memberships_removed),
    revisionsCreated: requiredInteger(row.revisions_created),
    ambiguous: requiredInteger(row.ambiguous_count),
    deferred: requiredInteger(row.deferred_count),
    unchanged: requiredInteger(row.unchanged_count),
  };
}

function serializeDecision(decision: GroupingDecision) {
  return {
    message_id: decision.messageId,
    source_fingerprint: decision.sourceFingerprint,
    state: decision.state,
    group_key: decision.groupKey,
    owner_teams_user_id: decision.ownerTeamsUserId,
    reason: decision.reason,
    score: decision.score,
  };
}

export class SupabaseConversationGroupingRepository
  implements ConversationGroupingRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async loadSources(limit: number): Promise<GroupableMessage[]> {
    const { data, error } = await this.client.rpc(
      "load_conversation_grouping_sources",
      { p_limit: limit },
    );
    if (error || !Array.isArray(data)) {
      throw new ConversationGroupingError(databaseCode(error?.code));
    }
    return data.map(parseMessage);
  }

  async applyDecisions(options: {
    algorithmVersion: string;
    decisions: readonly GroupingDecision[];
  }): Promise<GroupingPersistenceSummary> {
    const { data, error } = await this.client.rpc(
      "apply_conversation_grouping",
      {
        p_algorithm_version: options.algorithmVersion,
        p_decisions: options.decisions.map(serializeDecision),
      },
    );
    if (error) {
      throw new ConversationGroupingError(databaseCode(error.code));
    }
    return parseSummary(data);
  }
}
