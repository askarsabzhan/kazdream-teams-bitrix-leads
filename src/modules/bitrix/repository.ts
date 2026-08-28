import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalLeadPayloadSchema } from "../leads/canonicalization/schema";

import { BitrixSyncError } from "./errors";
import type {
  CachedManagerMapping,
  CrmSourceEvidence,
  CrmSyncClaim,
  CrmSyncRepository,
  CrmVerificationTarget,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function integerValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  return parsed;
}

function positiveInteger(value: unknown): number {
  const parsed = integerValue(value);
  if (parsed < 1) throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  return parsed;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : positiveInteger(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  return value.map(stringValue);
}

function parseEvidence(value: unknown): CrmSourceEvidence {
  if (!isRecord(value)) throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  const evidenceType = stringValue(value.evidence_type);
  if (!["teams_text", "reply_text", "transcript", "ocr"].includes(evidenceType)) {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  return {
    evidenceType: evidenceType as CrmSourceEvidence["evidenceType"],
    text: stringValue(value.text),
  };
}

function parseMapping(value: unknown): CachedManagerMapping {
  if (!isRecord(value)) throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  return {
    bitrixUserId: positiveInteger(value.bitrix_user_id),
    email: nullableString(value.email),
  };
}

function parseClaim(value: unknown): CrmSyncClaim {
  if (!isRecord(value) || !Array.isArray(value.source_evidence) || !Array.isArray(value.cached_manager_mappings)) {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  const syncAction = nullableString(value.sync_action);
  if (syncAction !== null && !["created", "updated", "recovered"].includes(syncAction)) {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  const commentState = stringValue(value.source_comment_state);
  if (commentState !== "pending" && commentState !== "succeeded") {
    throw new BitrixSyncError("INVALID_CRM_SYNC_ROW", "permanent_failed");
  }
  return {
    outboxId: stringValue(value.outbox_id),
    leaseId: stringValue(value.lease_id),
    attempts: positiveInteger(value.attempts),
    leadId: stringValue(value.lead_id),
    leadRevision: positiveInteger(value.lead_revision),
    localBitrixLeadId: nullablePositiveInteger(value.local_bitrix_lead_id),
    outboxBitrixLeadId: nullablePositiveInteger(value.outbox_bitrix_lead_id),
    syncAction: syncAction as CrmSyncClaim["syncAction"],
    crmCompletedAt: nullableString(value.crm_completed_at),
    sourceCommentState: commentState,
    sourceCommentMarker: stringValue(value.source_comment_marker),
    bitrixSourceGroupId: stringValue(value.bitrix_source_group_id),
    assignedTeamsUserId: nullableString(value.assigned_teams_user_id),
    canonicalPayload: canonicalLeadPayloadSchema.parse(value.canonical_payload),
    summaryRu: stringValue(value.summary_ru),
    groupIds: stringArray(value.group_ids),
    teamsMessageIds: stringArray(value.teams_message_ids),
    sourceEvidence: value.source_evidence.map(parseEvidence),
    cachedManagerMappings: value.cached_manager_mappings.map(parseMapping),
  };
}

function parseVerification(value: unknown): CrmVerificationTarget {
  if (!isRecord(value) || typeof value.source_comment_confirmed !== "boolean") {
    throw new BitrixSyncError("INVALID_CRM_VERIFICATION_ROW", "permanent_failed");
  }
  return {
    leadId: stringValue(value.lead_id),
    leadRevision: positiveInteger(value.lead_revision),
    bitrixLeadId: positiveInteger(value.bitrix_lead_id),
    bitrixSourceGroupId: stringValue(value.bitrix_source_group_id),
    assignedBitrixUserId: positiveInteger(value.assigned_bitrix_user_id),
    assignedManagerEmail: nullableString(value.assigned_manager_email),
    canonicalPayload: canonicalLeadPayloadSchema.parse(value.canonical_payload),
    summaryRu: stringValue(value.summary_ru),
    groupIds: stringArray(value.group_ids),
    teamsMessageIds: stringArray(value.teams_message_ids),
    sourceCommentConfirmed: value.source_comment_confirmed,
  };
}

function databaseCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/iu.test(value)
    ? value.toUpperCase()
    : "CRM_SYNC_DATABASE_ERROR";
}

export class SupabaseCrmSyncRepository implements CrmSyncRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claim(options: Parameters<CrmSyncRepository["claim"]>[0]): Promise<CrmSyncClaim[]> {
    const { data, error } = await this.client.rpc("claim_crm_sync_outbox", {
      p_worker_id: options.workerId,
      p_limit: options.limit,
      p_lease_seconds: options.leaseSeconds,
    });
    if (error || !Array.isArray(data)) {
      throw new BitrixSyncError(databaseCode(error?.code), "retryable_failed");
    }
    return data.map(parseClaim);
  }

  async persistManagerMapping(
    options: Parameters<CrmSyncRepository["persistManagerMapping"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("persist_crm_manager_mapping", {
      p_teams_user_id: options.teamsUserId,
      p_email: options.email,
      p_bitrix_user_id: options.bitrixUserId,
    });
    if (error) throw new BitrixSyncError(databaseCode(error.code), "permanent_failed");
  }

  async completeLeadDelivery(
    options: Parameters<CrmSyncRepository["completeLeadDelivery"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_crm_lead_delivery", {
      p_outbox_id: options.claim.outboxId,
      p_lease_id: options.claim.leaseId,
      p_bitrix_lead_id: options.bitrixLeadId,
      p_sync_action: options.action,
    });
    if (error) throw new BitrixSyncError(databaseCode(error.code), "retryable_failed");
  }

  async complete(options: Parameters<CrmSyncRepository["complete"]>[0]): Promise<void> {
    const { error } = await this.client.rpc("complete_crm_sync_outbox", {
      p_outbox_id: options.claim.outboxId,
      p_lease_id: options.claim.leaseId,
      p_timeline_comment_id: options.timelineCommentId,
      p_duration_ms: options.durationMs,
    });
    if (error) throw new BitrixSyncError(databaseCode(error.code), "retryable_failed");
  }

  async recordOutcome(
    options: Parameters<CrmSyncRepository["recordOutcome"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("record_crm_sync_outcome", {
      p_outbox_id: options.claim.outboxId,
      p_lease_id: options.claim.leaseId,
      p_outcome: options.outcome,
      p_error_code: options.errorCode,
      p_duration_ms: options.durationMs,
      p_retry_delay_seconds: options.retryDelaySeconds,
    });
    if (error) throw new BitrixSyncError(databaseCode(error.code), "retryable_failed");
  }

  async loadVerificationTargets(): Promise<CrmVerificationTarget[]> {
    const { data, error } = await this.client.rpc("load_crm_sync_verification_targets");
    if (error || !Array.isArray(data)) {
      throw new BitrixSyncError(databaseCode(error?.code), "retryable_failed");
    }
    return data.map(parseVerification);
  }
}
