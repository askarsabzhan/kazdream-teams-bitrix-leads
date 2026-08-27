import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AttachmentAcquisitionError,
  type AttachmentAcquisitionClaim,
  type AttachmentAcquisitionFailureState,
  type AttachmentAcquisitionRepository,
  type ValidatedAttachment,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  code = "INVALID_ACQUISITION_CLAIM",
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AttachmentAcquisitionError(code, "retryable_failed");
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function sourceLocator(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new AttachmentAcquisitionError(
      "INVALID_ACQUISITION_CLAIM",
      "retryable_failed",
    );
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    throw new AttachmentAcquisitionError(
      "INVALID_ACQUISITION_CLAIM",
      "retryable_failed",
    );
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseClaim(value: unknown): AttachmentAcquisitionClaim {
  if (!isRecord(value)) {
    throw new AttachmentAcquisitionError(
      "INVALID_ACQUISITION_CLAIM",
      "retryable_failed",
    );
  }
  const attachmentKind = value.attachment_kind;
  const fetchAttempts = value.fetch_attempts;
  const sourceSizeBytes = value.source_size_bytes;
  if (
    (attachmentKind !== "hosted_content" && attachmentKind !== "reference") ||
    typeof fetchAttempts !== "number" ||
    !Number.isSafeInteger(fetchAttempts) ||
    fetchAttempts < 1 ||
    (sourceSizeBytes !== null &&
      (typeof sourceSizeBytes !== "number" ||
        !Number.isSafeInteger(sourceSizeBytes) ||
        sourceSizeBytes < 0))
  ) {
    throw new AttachmentAcquisitionError(
      "INVALID_ACQUISITION_CLAIM",
      "retryable_failed",
    );
  }

  return {
    attachmentId: requiredString(value.attachment_id),
    teamsMessageId: requiredString(value.teams_message_id),
    leaseId: requiredString(value.lease_id),
    tenantId: requiredString(value.tenant_id),
    teamId: requiredString(value.team_id),
    channelId: requiredString(value.channel_id),
    externalMessageId: requiredString(value.external_message_id),
    rootExternalMessageId: optionalString(value.root_external_message_id),
    attachmentKind,
    sourceLocator: sourceLocator(value.source_locator),
    declaredMimeType: optionalString(value.declared_mime_type),
    sourceSizeBytes,
    fetchAttempts,
  };
}

function safeDatabaseCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/i.test(value)
    ? value.toUpperCase()
    : "ATTACHMENT_DATABASE_ERROR";
}

function transitionState(value: unknown): string {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    typeof value[0].fetch_state !== "string"
  ) {
    throw new AttachmentAcquisitionError(
      "INVALID_ACQUISITION_TRANSITION_RESULT",
      "retryable_failed",
    );
  }
  return value[0].fetch_state;
}

function assertTransitionResult(
  value: unknown,
  expectedState: string,
): void {
  if (transitionState(value) !== expectedState) {
    throw new AttachmentAcquisitionError(
      "INVALID_ACQUISITION_TRANSITION_RESULT",
      "retryable_failed",
    );
  }
}

export class SupabaseAttachmentAcquisitionRepository
  implements AttachmentAcquisitionRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async claim(options: {
    limit: number;
    leaseSeconds: number;
  }): Promise<AttachmentAcquisitionClaim[]> {
    const { data, error } = await this.client.rpc(
      "claim_teams_attachment_acquisition",
      {
        p_limit: options.limit,
        p_lease_seconds: options.leaseSeconds,
      },
    );
    if (error || !Array.isArray(data)) {
      throw new AttachmentAcquisitionError(
        safeDatabaseCode(error?.code),
        "retryable_failed",
      );
    }
    return data.map(parseClaim);
  }

  async complete(options: {
    claim: AttachmentAcquisitionClaim;
    storagePath: string;
    validated: ValidatedAttachment;
  }): Promise<void> {
    const { data, error } = await this.client.rpc(
      "complete_teams_attachment_acquisition",
      {
        p_attachment_id: options.claim.attachmentId,
        p_lease_id: options.claim.leaseId,
        p_storage_path: options.storagePath,
        p_sha256: options.validated.sha256,
        p_size_bytes: options.validated.byteLength,
        p_mime_type: options.validated.mimeType,
      },
    );
    if (error) {
      throw new AttachmentAcquisitionError(
        safeDatabaseCode(error.code),
        "retryable_failed",
      );
    }
    assertTransitionResult(data, "fetched");
  }

  async recordOutcome(options: {
    claim: AttachmentAcquisitionClaim;
    outcome: AttachmentAcquisitionFailureState;
    errorCode: string;
  }): Promise<void> {
    const { data, error } = await this.client.rpc(
      "record_teams_attachment_acquisition_outcome",
      {
        p_attachment_id: options.claim.attachmentId,
        p_lease_id: options.claim.leaseId,
        p_outcome: options.outcome,
        p_error_code: options.errorCode,
      },
    );
    if (error) {
      throw new AttachmentAcquisitionError(
        safeDatabaseCode(error.code),
        "retryable_failed",
      );
    }
    const actualState = transitionState(data);
    const validState =
      actualState === options.outcome ||
      (options.outcome === "retryable_failed" &&
        actualState === "permanent_failed");
    if (!validState) {
      throw new AttachmentAcquisitionError(
        "INVALID_ACQUISITION_TRANSITION_RESULT",
        "retryable_failed",
      );
    }
  }
}
