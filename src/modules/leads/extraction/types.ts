import type { AiProviderUsage } from "../../ai/providers/usage";

export const EXTRACTION_PROMPT_VERSION = "group-candidate-v1";
export const EXTRACTION_SCHEMA_VERSION = "group-candidate-schema-v2";
export const EXTRACTION_PROVIDER_NAME = "openai";

export type GroupEvidenceType =
  | "teams_text"
  | "reply_text"
  | "transcript"
  | "ocr";

export interface GroupEvidenceItem {
  id: string;
  type: GroupEvidenceType;
  teamsMessageId: string;
  attachmentId: string | null;
  text: string;
}

export interface GroupExtractionClaim {
  groupId: string;
  campaignId: string | null;
  leaseId: string;
  groupingRevision: number;
  groupingAlgorithmVersion: string;
  extractionSourceFingerprint: string;
  extractionRevision: number;
  extractionAttempts: number;
  providerName: string;
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
  evidenceItems: GroupEvidenceItem[];
}

export type SupportedFieldStatus = "supported" | "conflicted" | "uncertain";
export type NullableFieldStatus = "supported" | "uncertain";
export type CandidateLeadType = "Partner" | "Customer";
export type CandidateEligibilityState = "eligible" | "not_eligible";
export type CandidateEligibilityReason =
  | "MISSING_FULL_NAME"
  | "MISSING_PHONE"
  | "CONFLICTED_FULL_NAME"
  | null;

export interface CandidateField {
  value: string | null;
  evidenceIds: string[];
  status: SupportedFieldStatus;
}

export interface CandidateListValue {
  value: string;
  evidenceIds: string[];
}

export interface GroupCandidatePayload {
  person: {
    fullName: CandidateField;
    company: CandidateField;
    jobTitle: CandidateField;
  };
  phones: CandidateListValue[];
  emails: CandidateListValue[];
  relationshipIndicators: CandidateListValue[];
  productInterests: CandidateListValue[];
  region: {
    value: "Europe" | null;
    evidenceIds: string[];
    status: NullableFieldStatus;
  };
  priority: {
    value: "High" | "Medium" | "Low" | null;
    evidenceIds: string[];
    status: NullableFieldStatus;
  };
  facts: Array<{ text: string; evidenceIds: string[] }>;
  leadType: {
    value: CandidateLeadType;
    evidenceIds: string[];
    reason:
      | "EXPLICIT_PARTNER_INDICATOR"
      | "EXPLICIT_CUSTOMER_INDICATOR"
      | "EXPLICIT_LEAD_TYPE_CONFLICT"
      | "CUSTOMER_DEFAULT";
  };
  campaign: {
    exhibition: "Hannover Messe 2026";
    exhibitionBitrixId: 63;
    source: "EXHIBITION";
  };
  eligibility: {
    state: CandidateEligibilityState;
    reasonCode: CandidateEligibilityReason;
  };
}

export interface GroupFieldEvidenceWrite {
  fieldName: string;
  valueJson: unknown;
  normalizedValue: string;
  evidenceRefId: string;
  teamsMessageId: string | null;
  attachmentId: string | null;
  method: GroupEvidenceType | "system_default";
  validationStatus: "accepted" | "conflicted";
}

export interface ValidatedGroupExtraction {
  candidate: GroupCandidatePayload;
  fieldEvidence: GroupFieldEvidenceWrite[];
}

export interface GroupExtractionProviderResult {
  output: unknown;
  usage: AiProviderUsage;
}

export interface GroupExtractionProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  extract(evidenceItems: readonly GroupEvidenceItem[]): Promise<GroupExtractionProviderResult>;
}

export type GroupExtractionFailureState =
  | "retryable_failed"
  | "permanent_failed";

export interface GroupExtractionVerificationSnapshot {
  groupId: string;
  extractionRevision: number;
  candidate: GroupCandidatePayload;
  evidenceItems: GroupEvidenceItem[];
  fieldEvidence: GroupFieldEvidenceReference[];
}

export interface GroupFieldEvidenceReference {
  extractionRevision: number;
  fieldName: string;
  evidenceRefId: string;
  teamsMessageId: string | null;
  attachmentId: string | null;
  method: GroupEvidenceType | "system_default";
  validationStatus: "accepted" | "conflicted";
}

export interface GroupExtractionChecks {
  groupARequiredContact: boolean;
  groupBRequiredContact: boolean;
  partnerRule: boolean;
  evidenceReferences: boolean;
  noHallucinatedContact: boolean;
  eligibilityRule: boolean;
  customerDefaultProvenance: boolean;
  campaignConfig: boolean;
}

export interface GroupExtractionSummary {
  groupsSeen: number;
  groupsProcessed: number;
  failed: number;
  openaiRequests: number;
  candidateUpdates: number;
  newFieldEvidence: number;
  jobsCompleted: number;
  providerDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  checks: GroupExtractionChecks;
}

export interface GroupExtractionRepository {
  claim(configuration: {
    providerName: string;
    providerModel: string;
    promptVersion: string;
    schemaVersion: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<GroupExtractionClaim[]>;
  complete(options: {
    claim: GroupExtractionClaim;
    extraction: ValidatedGroupExtraction;
    durationMs: number;
    usage: AiProviderUsage;
  }): Promise<number>;
  recordOutcome(options: {
    claim: GroupExtractionClaim;
    outcome: GroupExtractionFailureState;
    errorCode: string;
    durationMs: number;
  }): Promise<void>;
  loadVerificationSnapshots(): Promise<GroupExtractionVerificationSnapshot[]>;
}

export interface GroupExtractionWorkerOptions {
  repository: GroupExtractionRepository;
  provider: GroupExtractionProvider;
  limit: number;
  leaseSeconds: number;
}

export class GroupExtractionError extends Error {
  readonly code: string;
  readonly outcome: GroupExtractionFailureState;

  constructor(code: string, outcome: GroupExtractionFailureState) {
    const safeCode = /^[A-Z0-9_]{1,64}$/.test(code)
      ? code
      : "GROUP_EXTRACTION_ERROR";
    super(safeCode);
    this.name = "GroupExtractionError";
    this.code = safeCode;
    this.outcome = outcome;
  }
}
