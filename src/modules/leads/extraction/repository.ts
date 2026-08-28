import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { groupCandidatePayloadSchema } from "./validation";
import {
  GroupExtractionError,
  type GroupEvidenceItem,
  type GroupExtractionClaim,
  type GroupExtractionRepository,
  type GroupExtractionVerificationSnapshot,
  type GroupFieldEvidenceReference,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return Number(value);
}

function parseEvidenceItem(value: unknown): GroupEvidenceItem {
  if (!isRecord(value)) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  const type = value.evidence_type;
  if (
    type !== "teams_text" &&
    type !== "reply_text" &&
    type !== "transcript" &&
    type !== "ocr"
  ) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return {
    id: requiredString(value.evidence_id),
    type,
    teamsMessageId: requiredString(value.teams_message_id),
    attachmentId: nullableString(value.attachment_id),
    text: requiredString(value.evidence_text),
  };
}

function parseEvidenceItems(value: unknown): GroupEvidenceItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return value.map(parseEvidenceItem);
}

function parseClaim(value: unknown): GroupExtractionClaim {
  if (!isRecord(value)) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  const fingerprint = requiredString(value.extraction_source_fingerprint);
  if (!/^[0-9a-f]{64}$/u.test(fingerprint)) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return {
    groupId: requiredString(value.lead_group_id),
    campaignId: nullableString(value.campaign_id),
    leaseId: requiredString(value.lease_id),
    groupingRevision: requiredInteger(value.grouping_revision),
    groupingAlgorithmVersion: requiredString(value.grouping_algorithm_version),
    extractionSourceFingerprint: fingerprint,
    extractionRevision: requiredInteger(value.extraction_revision),
    extractionAttempts: requiredInteger(value.extraction_attempts),
    providerName: requiredString(value.extraction_provider),
    providerModel: requiredString(value.extraction_model),
    promptVersion: requiredString(value.extraction_prompt_version),
    schemaVersion: requiredString(value.extraction_schema_version),
    evidenceItems: parseEvidenceItems(value.evidence_items),
  };
}

function databaseCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/iu.test(value)
    ? value.toUpperCase()
    : "GROUP_EXTRACTION_DATABASE_ERROR";
}

function transition(value: unknown): { state: string; evidenceCount: number } {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_TRANSITION", "retryable_failed");
  }
  return {
    state: requiredString(value[0].extraction_state),
    evidenceCount: requiredInteger(value[0].field_evidence_inserted),
  };
}

function parseSnapshot(value: unknown): Omit<
  GroupExtractionVerificationSnapshot,
  "extractionRevision" | "fieldEvidence"
> {
  if (!isRecord(value)) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return {
    groupId: requiredString(value.lead_group_id),
    candidate: groupCandidatePayloadSchema.parse(value.candidate_payload),
    evidenceItems: parseEvidenceItems(value.evidence_items),
  };
}

function parseFieldEvidenceReference(value: unknown): GroupFieldEvidenceReference & {
  groupId: string;
} {
  if (!isRecord(value)) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  const method = value.method;
  if (
    method !== "teams_text" &&
    method !== "reply_text" &&
    method !== "transcript" &&
    method !== "ocr" &&
    method !== "system_default"
  ) {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  const validationStatus = value.validation_status;
  if (validationStatus !== "accepted" && validationStatus !== "conflicted") {
    throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
  }
  return {
    groupId: requiredString(value.lead_group_id),
    extractionRevision: requiredInteger(value.extraction_revision),
    fieldName: requiredString(value.field_name),
    evidenceRefId: requiredString(value.evidence_ref_id),
    teamsMessageId: nullableString(value.teams_message_id),
    attachmentId: nullableString(value.attachment_id),
    method,
    validationStatus,
  };
}

export class SupabaseGroupExtractionRepository
  implements GroupExtractionRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async claim(configuration: {
    providerName: string;
    providerModel: string;
    promptVersion: string;
    schemaVersion: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<GroupExtractionClaim[]> {
    const { data, error } = await this.client.rpc("claim_lead_group_extractions", {
      p_provider: configuration.providerName,
      p_model: configuration.providerModel,
      p_prompt_version: configuration.promptVersion,
      p_schema_version: configuration.schemaVersion,
      p_limit: configuration.limit,
      p_lease_seconds: configuration.leaseSeconds,
    });
    if (error || !Array.isArray(data)) {
      throw new GroupExtractionError(databaseCode(error?.code), "retryable_failed");
    }
    return data.map(parseClaim);
  }

  async complete(options: Parameters<GroupExtractionRepository["complete"]>[0]): Promise<number> {
    const { claim, extraction, durationMs, usage } = options;
    const { data, error } = await this.client.rpc("complete_lead_group_extraction", {
      p_lead_group_id: claim.groupId,
      p_lease_id: claim.leaseId,
      p_source_fingerprint: claim.extractionSourceFingerprint,
      p_candidate_payload: extraction.candidate,
      p_eligibility_state: extraction.candidate.eligibility.state,
      p_eligibility_reason_code: extraction.candidate.eligibility.reasonCode,
      p_field_evidence: extraction.fieldEvidence.map((row) => ({
        field_name: row.fieldName,
        value_json: row.valueJson,
        normalized_value: row.normalizedValue,
        evidence_ref_id: row.evidenceRefId,
        teams_message_id: row.teamsMessageId,
        attachment_id: row.attachmentId,
        method: row.method,
        validation_status: row.validationStatus,
      })),
      p_duration_ms: durationMs,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_total_tokens: usage.totalTokens,
    });
    if (error) {
      throw new GroupExtractionError(databaseCode(error.code), "retryable_failed");
    }
    const result = transition(data);
    if (result.state !== "extracted") {
      throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_TRANSITION", "retryable_failed");
    }
    return result.evidenceCount;
  }

  async recordOutcome(
    options: Parameters<GroupExtractionRepository["recordOutcome"]>[0],
  ): Promise<void> {
    const { data, error } = await this.client.rpc("record_lead_group_extraction_outcome", {
      p_lead_group_id: options.claim.groupId,
      p_lease_id: options.claim.leaseId,
      p_outcome: options.outcome,
      p_error_code: options.errorCode,
      p_duration_ms: options.durationMs,
    });
    if (error) {
      throw new GroupExtractionError(databaseCode(error.code), "retryable_failed");
    }
    if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
      throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_TRANSITION", "retryable_failed");
    }
    const state = requiredString(data[0].extraction_state);
    if (
      state !== options.outcome &&
      !(options.outcome === "retryable_failed" && state === "permanent_failed")
    ) {
      throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_TRANSITION", "retryable_failed");
    }
  }

  async loadVerificationSnapshots(): Promise<GroupExtractionVerificationSnapshot[]> {
    const { data, error } = await this.client.rpc(
      "load_lead_group_extraction_verification",
    );
    if (error || !Array.isArray(data)) {
      throw new GroupExtractionError(databaseCode(error?.code), "retryable_failed");
    }
    if (data.length === 0) return [];
    try {
      const snapshots = data.map(parseSnapshot);
      const groupIds = snapshots.map((snapshot) => snapshot.groupId);
      const [groupsResult, evidenceResult] = await Promise.all([
        this.client
          .from("lead_groups")
          .select("id,extraction_revision")
          .in("id", groupIds),
        this.client
          .from("field_evidence")
          .select(
            "lead_group_id,extraction_revision,field_name,evidence_ref_id,teams_message_id,attachment_id,method,validation_status",
          )
          .in("lead_group_id", groupIds),
      ]);
      if (
        groupsResult.error ||
        evidenceResult.error ||
        !Array.isArray(groupsResult.data) ||
        !Array.isArray(evidenceResult.data)
      ) {
        throw new GroupExtractionError(
          databaseCode(groupsResult.error?.code ?? evidenceResult.error?.code),
          "retryable_failed",
        );
      }
      const revisions = new Map(
        groupsResult.data.map((row) => {
          if (!isRecord(row)) {
            throw new GroupExtractionError(
              "INVALID_GROUP_EXTRACTION_ROW",
              "retryable_failed",
            );
          }
          return [requiredString(row.id), requiredInteger(row.extraction_revision)] as const;
        }),
      );
      const fieldEvidence = evidenceResult.data.map(parseFieldEvidenceReference);
      return snapshots.map((snapshot) => {
        const extractionRevision = revisions.get(snapshot.groupId);
        if (extractionRevision === undefined) {
          throw new GroupExtractionError(
            "INVALID_GROUP_EXTRACTION_ROW",
            "retryable_failed",
          );
        }
        return {
          ...snapshot,
          extractionRevision,
          fieldEvidence: fieldEvidence
            .filter(
              (row) =>
                row.groupId === snapshot.groupId &&
                row.extractionRevision === extractionRevision,
            )
            .map((row) => ({
              extractionRevision: row.extractionRevision,
              fieldName: row.fieldName,
              evidenceRefId: row.evidenceRefId,
              teamsMessageId: row.teamsMessageId,
              attachmentId: row.attachmentId,
              method: row.method,
              validationStatus: row.validationStatus,
            })),
        };
      });
    } catch (error) {
      if (error instanceof GroupExtractionError) throw error;
      throw new GroupExtractionError("INVALID_GROUP_EXTRACTION_ROW", "retryable_failed");
    }
  }
}
