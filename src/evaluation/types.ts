import type { GroupableAttachmentEvidence, GroupableMessage } from "../modules/leads/grouping/types";

export interface SyntheticAttachment extends GroupableAttachmentEvidence {
  fixtureId: number;
}

export interface SyntheticMessage extends Omit<GroupableMessage, "attachments"> {
  sequence: number;
  encounterId: string | null;
  attachments: SyntheticAttachment[];
}

export interface EncounterGroundTruth {
  encounterId: string;
  canonicalId: string | null;
  eligible: boolean;
  leadType: "Partner" | "Customer";
  managerId: string;
  fullNameStatus: "supported" | "conflicted" | "uncertain";
  phoneCount: number;
  emailCount: number;
}

export interface CanonicalGroundTruth {
  canonicalId: string;
  responsibleManagerId: string;
  leadType: "Partner" | "Customer";
  phoneCount: number;
  emailCount: number;
}

export interface ReplayMetrics {
  duplicateMessages: number;
  duplicateMemberships: number;
  duplicateGroups: number;
  duplicateCanonicalLeads: number;
  duplicateCrmIntents: number;
}

export interface EvaluationMetrics {
  mode: "DETERMINISTIC_PIPELINE_METRICS";
  messageCount: number;
  expectedCanonicalLeads: number;
  actualCanonicalLeads: number;
  leadCountAccuracy: number;
  falseMerges: number;
  falseSplits: number;
  duplicateCanonicalLeads: number;
  eligibilityAccuracy: number;
  partnerCustomerAccuracy: number;
  responsibleManagerAccuracy: number;
  requiredContactFieldAccuracy: number;
  hallucinatedContactValues: number;
  ambiguousCaseAccuracy: number;
  precision: number;
  recall: number;
  f1: number;
  replay: ReplayMetrics;
  firstRunWrites: {
    messages: number;
    memberships: number;
    groups: number;
    canonicalLeads: number;
    crmIntents: number;
  };
  edgeCasesPassed: number;
  edgeCasesTotal: number;
  aiRequests: 0;
}
