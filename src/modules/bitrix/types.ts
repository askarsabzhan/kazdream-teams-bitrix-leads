import type { CanonicalLeadPayload } from "../leads/canonicalization/types";

export type BitrixScalar = string | number | boolean;
export type BitrixFieldValue =
  | BitrixScalar
  | readonly BitrixScalar[]
  | readonly Record<string, BitrixScalar>[];
export type BitrixLeadFields = Record<string, BitrixFieldValue>;

export interface BitrixFieldMetadata {
  name: string;
  type: string;
  multiple: boolean;
  required: boolean;
  items: Array<{ id: number; value: string }>;
}

export interface BitrixDiscoveryConfiguration {
  fields: Record<string, BitrixFieldMetadata>;
  checks: {
    BITRIX_WEBHOOK_AUTH: boolean;
    BITRIX_REQUIRED_FIELDS: boolean;
    BITRIX_ENUMS: boolean;
    BITRIX_TEAMS_FIELDS: boolean;
    BITRIX_USER_DIRECTORY: boolean;
  };
}

export interface CachedManagerMapping {
  bitrixUserId: number;
  email: string | null;
}

export interface CrmSourceEvidence {
  evidenceType: "teams_text" | "reply_text" | "transcript" | "ocr";
  text: string;
}

export interface CrmSyncClaim {
  outboxId: string;
  leaseId: string;
  attempts: number;
  leadId: string;
  leadRevision: number;
  localBitrixLeadId: number | null;
  outboxBitrixLeadId: number | null;
  syncAction: "created" | "updated" | "recovered" | null;
  crmCompletedAt: string | null;
  sourceCommentState: "pending" | "succeeded";
  sourceCommentMarker: string;
  bitrixSourceGroupId: string;
  assignedTeamsUserId: string | null;
  canonicalPayload: CanonicalLeadPayload;
  summaryRu: string;
  groupIds: string[];
  teamsMessageIds: string[];
  sourceEvidence: CrmSourceEvidence[];
  cachedManagerMappings: CachedManagerMapping[];
}

export interface CrmVerificationTarget {
  leadId: string;
  leadRevision: number;
  bitrixLeadId: number;
  bitrixSourceGroupId: string;
  assignedBitrixUserId: number;
  assignedManagerEmail: string | null;
  canonicalPayload: CanonicalLeadPayload;
  summaryRu: string;
  groupIds: string[];
  teamsMessageIds: string[];
  sourceCommentConfirmed: boolean;
}

export interface CrmSyncRepository {
  claim(options: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<CrmSyncClaim[]>;
  persistManagerMapping(options: {
    teamsUserId: string;
    email: string;
    bitrixUserId: number;
  }): Promise<void>;
  completeLeadDelivery(options: {
    claim: CrmSyncClaim;
    bitrixLeadId: number;
    action: "created" | "updated" | "recovered";
  }): Promise<void>;
  complete(options: {
    claim: CrmSyncClaim;
    timelineCommentId: number;
    durationMs: number;
  }): Promise<void>;
  recordOutcome(options: {
    claim: CrmSyncClaim;
    outcome: "retryable_failed" | "permanent_failed" | "blocked";
    errorCode: string;
    durationMs: number;
    retryDelaySeconds: number;
  }): Promise<void>;
  loadVerificationTargets(): Promise<CrmVerificationTarget[]>;
}

export interface TeamsManagerDirectory {
  resolveEmails(teamsUserId: string): Promise<string[]>;
}

export interface BitrixLeadGateway {
  lookupBySourceGroup(sourceGroupId: string): Promise<number[]>;
  add(fields: BitrixLeadFields): Promise<number>;
  update(bitrixLeadId: number, fields: BitrixLeadFields): Promise<void>;
  get(bitrixLeadId: number): Promise<Record<string, unknown>>;
  addSourceComment(bitrixLeadId: number, comment: string): Promise<number>;
}

export interface BitrixUserGateway {
  findExactByEmail(email: string): Promise<number[]>;
}

export interface CrmSyncSummary {
  outboxSeen: number;
  created: number;
  updated: number;
  recovered: number;
  blocked: number;
  failed: number;
}

export interface BitrixProtectedChecks {
  BITRIX_LEAD_COUNT_CHECK: boolean;
  BITRIX_RESPONSIBLE_CHECK: boolean;
  BITRIX_LEAD_TYPE_CHECK: boolean;
  BITRIX_EXHIBITION_CHECK: boolean;
  BITRIX_SOURCE_CHECK: boolean;
  BITRIX_CONTACT_FIELDS_CHECK: boolean;
  BITRIX_SUMMARY_CHECK: boolean;
  BITRIX_SOURCE_COMMENT_CHECK: boolean;
}
