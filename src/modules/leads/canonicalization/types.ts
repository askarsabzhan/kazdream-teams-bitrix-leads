import type { AiProviderUsage } from "../../ai/providers/usage";
import type { GroupCandidatePayload } from "../extraction/types";

export const CANONICAL_SUMMARY_PROVIDER = "openai";
export const CANONICAL_SUMMARY_MODEL = "gpt-4o-mini";
export const CANONICAL_SUMMARY_PROMPT_VERSION = "canonical-summary-ru-v1";

export type CanonicalIdentityKind = "phone" | "email";

export interface CanonicalIdentityKey {
  kind: CanonicalIdentityKind;
  normalizedValue: string;
}

export interface GroupContributor {
  teamsMessageId: string;
  authorTeamsUserId: string | null;
  sourceCreatedAt: string;
}

export interface EligibleCanonicalGroup {
  groupId: string;
  leadId: string | null;
  candidateSourceFingerprint: string;
  candidate: GroupCandidatePayload;
  contributors: GroupContributor[];
}

export interface CanonicalField {
  value: string | null;
  status: "supported" | "conflicted" | "uncertain";
  groupIds: string[];
}

export interface CanonicalListValue {
  value: string;
  normalizedValue: string;
  groupIds: string[];
}

export interface CanonicalLeadPayload {
  person: {
    fullName: CanonicalField;
    company: CanonicalField;
    jobTitle: CanonicalField;
  };
  phones: CanonicalListValue[];
  emails: CanonicalListValue[];
  relationshipIndicators: Array<{ value: string; groupIds: string[] }>;
  productInterests: Array<{ value: string; groupIds: string[] }>;
  region: { value: "Europe" | null; groupIds: string[] };
  priority: { value: "High" | "Medium" | "Low" | null; groupIds: string[] };
  facts: Array<{ text: string; groupIds: string[] }>;
  leadType: {
    value: "Partner" | "Customer";
    status: "supported" | "conflicted" | "defaulted";
    groupIds: string[];
  };
  campaign: {
    exhibition: "Hannover Messe 2026";
    exhibitionBitrixId: 63;
    source: "EXHIBITION";
  };
}

export interface CanonicalComposition {
  payload: CanonicalLeadPayload;
  identityKeys: CanonicalIdentityKey[];
  nameKey: string | null;
  companyKey: string | null;
}

export type CanonicalResolutionState = "linked" | "identity_conflict";

export interface CanonicalResolutionResult {
  groupId: string;
  leadId: string | null;
  state: CanonicalResolutionState;
  leadCreated: boolean;
  groupLinked: boolean;
}

export interface CanonicalCompositionResult {
  leadId: string;
  updated: boolean;
  revision: number;
}

export interface CanonicalSummaryEvidence {
  groupRef: string;
  evidenceRef: string;
  evidenceType: "teams_text" | "reply_text" | "transcript" | "ocr";
  text: string;
}

export interface CanonicalSummaryClaim {
  leadId: string;
  leaseId: string;
  sourceFingerprint: string;
  revision: number;
  attempts: number;
  provider: string;
  model: string;
  promptVersion: string;
  candidate: CanonicalLeadPayload;
  evidence: CanonicalSummaryEvidence[];
}

export interface CanonicalSummaryProviderResult {
  summaryRu: string;
  usage: AiProviderUsage;
}

export interface CanonicalSummaryProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  summarize(claim: CanonicalSummaryClaim): Promise<CanonicalSummaryProviderResult>;
}

export interface CanonicalizationRepository {
  loadEligibleGroups(limit?: number): Promise<EligibleCanonicalGroup[]>;
  resolveGroup(options: {
    group: EligibleCanonicalGroup;
    identityKeys: CanonicalIdentityKey[];
    nameKey: string | null;
    companyKey: string | null;
  }): Promise<CanonicalResolutionResult>;
  completeComposition(
    leadId: string,
    composition: CanonicalComposition,
  ): Promise<CanonicalCompositionResult>;
  claimSummaries(configuration: {
    provider: string;
    model: string;
    promptVersion: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<CanonicalSummaryClaim[]>;
  completeSummary(options: {
    claim: CanonicalSummaryClaim;
    summaryRu: string;
    durationMs: number;
    usage: AiProviderUsage;
  }): Promise<void>;
  recordSummaryFailure(options: {
    claim: CanonicalSummaryClaim;
    outcome: "retryable_failed" | "permanent_failed";
    errorCode: string;
    durationMs: number;
  }): Promise<void>;
}

export interface CanonicalizationSummary {
  groupsSeen: number;
  canonicalLeadsCreated: number;
  canonicalLeadsUpdated: number;
  groupsLinked: number;
  identityConflicts: number;
  summaryRequests: number;
  summariesCompleted: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class CanonicalizationError extends Error {
  readonly code: string;
  readonly outcome: "retryable_failed" | "permanent_failed";

  constructor(
    code: string,
    outcome: "retryable_failed" | "permanent_failed" = "retryable_failed",
  ) {
    const safeCode = /^[A-Z0-9_]{1,64}$/u.test(code)
      ? code
      : "CANONICALIZATION_ERROR";
    super(safeCode);
    this.name = "CanonicalizationError";
    this.code = safeCode;
    this.outcome = outcome;
  }
}
