import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AttachmentEvidenceError,
  type AttachmentEvidenceClaim,
  type AttachmentEvidenceClaimConfiguration,
  type AttachmentEvidenceCompletion,
  type AttachmentEvidenceFailureState,
  type AttachmentEvidenceOperation,
  type AttachmentEvidenceRepository,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AttachmentEvidenceError(
      "INVALID_AI_EVIDENCE_CLAIM",
      "retryable_failed",
    );
  }
  return value;
}

function requiredInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new AttachmentEvidenceError(
      "INVALID_AI_EVIDENCE_CLAIM",
      "retryable_failed",
    );
  }
  return value;
}

function operation(value: unknown): AttachmentEvidenceOperation {
  if (value !== "transcription" && value !== "image_text") {
    throw new AttachmentEvidenceError(
      "INVALID_AI_EVIDENCE_CLAIM",
      "retryable_failed",
    );
  }
  return value;
}

function parseClaim(value: unknown): AttachmentEvidenceClaim {
  if (!isRecord(value)) {
    throw new AttachmentEvidenceError(
      "INVALID_AI_EVIDENCE_CLAIM",
      "retryable_failed",
    );
  }
  const sourceSha256 = requiredString(value.source_sha256);
  if (!/^[0-9a-f]{64}$/.test(sourceSha256)) {
    throw new AttachmentEvidenceError(
      "INVALID_AI_EVIDENCE_CLAIM",
      "retryable_failed",
    );
  }
  return {
    attachmentId: requiredString(value.attachment_id),
    leaseId: requiredString(value.lease_id),
    operation: operation(value.operation_type),
    storagePath: requiredString(value.storage_path),
    mimeType: requiredString(value.mime_type),
    sizeBytes: requiredInteger(value.size_bytes),
    sourceSha256,
    providerName: requiredString(value.provider_name),
    providerModel: requiredString(value.provider_model),
    promptVersion: requiredString(value.prompt_version),
    processingRevision: requiredInteger(value.processing_revision),
    processingAttempts: requiredInteger(value.processing_attempts),
  };
}

function safeDatabaseCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/i.test(value)
    ? value.toUpperCase()
    : "AI_DATABASE_ERROR";
}

function transitionState(value: unknown): string {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    typeof value[0].processing_state !== "string"
  ) {
    throw new AttachmentEvidenceError(
      "INVALID_AI_EVIDENCE_TRANSITION",
      "retryable_failed",
    );
  }
  return value[0].processing_state;
}

export class SupabaseAttachmentEvidenceRepository
  implements AttachmentEvidenceRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async claim(
    configuration: AttachmentEvidenceClaimConfiguration,
  ): Promise<AttachmentEvidenceClaim[]> {
    const { data, error } = await this.client.rpc(
      "claim_attachment_ai_evidence",
      {
        p_provider: configuration.providerName,
        p_transcription_model: configuration.transcriptionModel,
        p_transcription_version: configuration.transcriptionVersion,
        p_image_model: configuration.imageModel,
        p_image_version: configuration.imageVersion,
        p_limit: configuration.limit,
        p_lease_seconds: configuration.leaseSeconds,
      },
    );
    if (error || !Array.isArray(data)) {
      throw new AttachmentEvidenceError(
        safeDatabaseCode(error?.code),
        "retryable_failed",
      );
    }
    return data.map(parseClaim);
  }

  async complete(completion: AttachmentEvidenceCompletion): Promise<void> {
    const { data, error } = await this.client.rpc(
      "complete_attachment_ai_evidence",
      {
        p_attachment_id: completion.claim.attachmentId,
        p_lease_id: completion.claim.leaseId,
        p_operation: completion.claim.operation,
        p_evidence_text: completion.evidenceText,
        p_document_type: completion.documentType,
        p_duration_ms: completion.durationMs,
        p_input_tokens: completion.usage.inputTokens,
        p_output_tokens: completion.usage.outputTokens,
        p_total_tokens: completion.usage.totalTokens,
        p_audio_duration_ms: completion.usage.audioDurationMs,
      },
    );
    if (error) {
      throw new AttachmentEvidenceError(
        safeDatabaseCode(error.code),
        "retryable_failed",
      );
    }
    if (transitionState(data) !== "processed") {
      throw new AttachmentEvidenceError(
        "INVALID_AI_EVIDENCE_TRANSITION",
        "retryable_failed",
      );
    }
  }

  async recordOutcome(options: {
    claim: AttachmentEvidenceClaim;
    outcome: AttachmentEvidenceFailureState;
    errorCode: string;
    durationMs: number;
  }): Promise<void> {
    const { data, error } = await this.client.rpc(
      "record_attachment_ai_evidence_outcome",
      {
        p_attachment_id: options.claim.attachmentId,
        p_lease_id: options.claim.leaseId,
        p_outcome: options.outcome,
        p_error_code: options.errorCode,
        p_duration_ms: options.durationMs,
      },
    );
    if (error) {
      throw new AttachmentEvidenceError(
        safeDatabaseCode(error.code),
        "retryable_failed",
      );
    }
    const state = transitionState(data);
    const expected =
      state === options.outcome ||
      (options.outcome === "retryable_failed" &&
        state === "permanent_failed");
    if (!expected) {
      throw new AttachmentEvidenceError(
        "INVALID_AI_EVIDENCE_TRANSITION",
        "retryable_failed",
      );
    }
  }
}
