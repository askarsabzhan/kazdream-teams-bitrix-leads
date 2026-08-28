import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { groupCandidatePayloadSchema } from "../extraction/validation";

import { canonicalLeadPayloadSchema } from "./schema";
import {
  CanonicalizationError,
  type CanonicalComposition,
  type CanonicalCompositionResult,
  type CanonicalIdentityKey,
  type CanonicalizationRepository,
  type CanonicalResolutionResult,
  type CanonicalSummaryClaim,
  type CanonicalSummaryEvidence,
  type EligibleCanonicalGroup,
  type GroupContributor,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return Number(value);
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return value;
}

function parseContributor(value: unknown): GroupContributor {
  if (!isRecord(value)) throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  return {
    teamsMessageId: requiredString(value.teams_message_id),
    authorTeamsUserId: nullableString(value.author_teams_user_id),
    sourceCreatedAt: requiredString(value.source_created_at),
  };
}

function parseEligibleGroup(value: unknown): EligibleCanonicalGroup {
  if (!isRecord(value) || !Array.isArray(value.contributors)) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  const fingerprint = requiredString(value.candidate_source_fingerprint);
  if (!/^[0-9a-f]{64}$/u.test(fingerprint)) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return {
    groupId: requiredString(value.lead_group_id),
    leadId: nullableString(value.lead_id),
    candidateSourceFingerprint: fingerprint,
    candidate: groupCandidatePayloadSchema.parse(value.candidate_payload),
    contributors: value.contributors.map(parseContributor),
  };
}

function parseResolution(value: unknown): CanonicalResolutionResult {
  if (!isRecord(value)) throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  const state = requiredString(value.resolution_state);
  if (state !== "linked" && state !== "identity_conflict") {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return {
    groupId: requiredString(value.lead_group_id),
    leadId: nullableString(value.lead_id),
    state,
    leadCreated: requiredBoolean(value.lead_created),
    groupLinked: requiredBoolean(value.group_linked),
  };
}

function parseCompositionResult(value: unknown): CanonicalCompositionResult {
  if (!isRecord(value)) throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  return {
    leadId: requiredString(value.lead_id),
    updated: requiredBoolean(value.canonical_updated),
    revision: requiredInteger(value.canonical_revision),
  };
}

function parseSummaryEvidence(value: unknown): CanonicalSummaryEvidence {
  if (!isRecord(value)) throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  const evidenceType = requiredString(value.evidence_type);
  if (
    evidenceType !== "teams_text" &&
    evidenceType !== "reply_text" &&
    evidenceType !== "transcript" &&
    evidenceType !== "ocr"
  ) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return {
    groupRef: requiredString(value.group_ref),
    evidenceRef: requiredString(value.evidence_ref),
    evidenceType,
    text: requiredString(value.text),
  };
}

function parseSummaryClaim(value: unknown): CanonicalSummaryClaim {
  if (!isRecord(value) || !Array.isArray(value.evidence_items)) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  const fingerprint = requiredString(value.source_fingerprint);
  if (!/^[0-9a-f]{64}$/u.test(fingerprint)) {
    throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
  }
  return {
    leadId: requiredString(value.lead_id),
    leaseId: requiredString(value.lease_id),
    sourceFingerprint: fingerprint,
    revision: requiredInteger(value.canonical_revision),
    attempts: requiredInteger(value.summary_attempts),
    provider: requiredString(value.summary_provider),
    model: requiredString(value.summary_model),
    promptVersion: requiredString(value.summary_prompt_version),
    candidate: canonicalLeadPayloadSchema.parse(value.candidate_payload),
    evidence: value.evidence_items.map(parseSummaryEvidence),
  };
}

function databaseCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/iu.test(value)
    ? value.toUpperCase()
    : "CANONICALIZATION_DATABASE_ERROR";
}

function identityRows(keys: readonly CanonicalIdentityKey[]): Array<Record<string, string>> {
  return keys.map((key) => ({
    kind: key.kind,
    normalized_value: key.normalizedValue,
  }));
}

export class SupabaseCanonicalizationRepository
  implements CanonicalizationRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async loadEligibleGroups(): Promise<EligibleCanonicalGroup[]> {
    const { data, error } = await this.client.rpc(
      "load_eligible_canonicalization_groups",
    );
    if (error || !Array.isArray(data)) {
      throw new CanonicalizationError(databaseCode(error?.code));
    }
    try {
      return data.map(parseEligibleGroup);
    } catch (error) {
      if (error instanceof CanonicalizationError) throw error;
      throw new CanonicalizationError("INVALID_CANONICALIZATION_ROW");
    }
  }

  async resolveGroup(
    options: Parameters<CanonicalizationRepository["resolveGroup"]>[0],
  ): Promise<CanonicalResolutionResult> {
    const { data, error } = await this.client.rpc("resolve_canonical_lead_group", {
      p_lead_group_id: options.group.groupId,
      p_candidate_source_fingerprint: options.group.candidateSourceFingerprint,
      p_identity_keys: identityRows(options.identityKeys),
      p_name_key: options.nameKey,
      p_company_key: options.companyKey,
    });
    if (error || !Array.isArray(data) || data.length !== 1) {
      throw new CanonicalizationError(databaseCode(error?.code));
    }
    return parseResolution(data[0]);
  }

  async completeComposition(
    leadId: string,
    composition: CanonicalComposition,
  ): Promise<CanonicalCompositionResult> {
    canonicalLeadPayloadSchema.parse(composition.payload);
    const { data, error } = await this.client.rpc(
      "complete_canonical_lead_composition",
      {
        p_lead_id: leadId,
        p_canonical_payload: composition.payload,
        p_identity_keys: identityRows(composition.identityKeys),
        p_name_key: composition.nameKey,
        p_company_key: composition.companyKey,
      },
    );
    if (error || !Array.isArray(data) || data.length !== 1) {
      throw new CanonicalizationError(databaseCode(error?.code));
    }
    return parseCompositionResult(data[0]);
  }

  async claimSummaries(
    configuration: Parameters<CanonicalizationRepository["claimSummaries"]>[0],
  ): Promise<CanonicalSummaryClaim[]> {
    const { data, error } = await this.client.rpc("claim_canonical_lead_summaries", {
      p_provider: configuration.provider,
      p_model: configuration.model,
      p_prompt_version: configuration.promptVersion,
      p_limit: configuration.limit,
      p_lease_seconds: configuration.leaseSeconds,
    });
    if (error || !Array.isArray(data)) {
      throw new CanonicalizationError(databaseCode(error?.code));
    }
    return data.map(parseSummaryClaim);
  }

  async completeSummary(
    options: Parameters<CanonicalizationRepository["completeSummary"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_canonical_lead_summary", {
      p_lead_id: options.claim.leadId,
      p_lease_id: options.claim.leaseId,
      p_source_fingerprint: options.claim.sourceFingerprint,
      p_summary_ru: options.summaryRu,
      p_duration_ms: options.durationMs,
      p_input_tokens: options.usage.inputTokens,
      p_output_tokens: options.usage.outputTokens,
      p_total_tokens: options.usage.totalTokens,
    });
    if (error) throw new CanonicalizationError(databaseCode(error.code));
  }

  async recordSummaryFailure(
    options: Parameters<CanonicalizationRepository["recordSummaryFailure"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc(
      "record_canonical_lead_summary_outcome",
      {
        p_lead_id: options.claim.leadId,
        p_lease_id: options.claim.leaseId,
        p_outcome: options.outcome,
        p_error_code: options.errorCode,
        p_duration_ms: options.durationMs,
      },
    );
    if (error) throw new CanonicalizationError(databaseCode(error.code));
  }
}
