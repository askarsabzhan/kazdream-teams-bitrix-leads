export const GROUPING_ALGORITHM_VERSION = "v1";

export type GroupingDecisionReason =
  | "explicit_reply"
  | "exact_phone"
  | "exact_email"
  | "name_company"
  | "new_distinct_identity"
  | "ambiguous_unassigned"
  | "evidence_pending";

export type GroupingDecisionState = "grouped" | "ambiguous" | "deferred";

export interface GroupableAttachmentEvidence {
  fetchState: string;
  processingState: string;
  operation: "transcription" | "image_text" | null;
  transcriptText: string | null;
  ocrText: string | null;
}

export interface GroupableMessage {
  id: string;
  campaignId: string | null;
  source: string;
  tenantId: string;
  teamId: string;
  channelId: string;
  externalMessageId: string;
  authorTeamsUserId: string | null;
  replyToExternalMessageId: string | null;
  sourceCreatedAt: string;
  bodyContent: string | null;
  contentRevision: number;
  inputFingerprint: string;
  evidenceReady: boolean;
  isBot: boolean;
  isServiceMessage: boolean;
  attachments: GroupableAttachmentEvidence[];
  currentGroupingState: string;
  currentAlgorithmVersion: string | null;
  currentGroupingFingerprint: string | null;
  currentGroupingReason: string | null;
  currentGroupKey: string | null;
}

export interface GroupingDecision {
  messageId: string;
  sourceFingerprint: string;
  state: GroupingDecisionState;
  groupKey: string | null;
  ownerTeamsUserId: string | null;
  reason: GroupingDecisionReason;
  score: number;
}

export interface GroupingPersistenceSummary {
  groupsCreated: number;
  membershipsCreated: number;
  membershipsRemoved: number;
  revisionsCreated: number;
  ambiguous: number;
  deferred: number;
  unchanged: number;
}

export interface GroupingProtectedChecks {
  rootReply: boolean;
  photoAudio: boolean;
  distinctContactsNotMerged: boolean;
}

export interface ConversationGroupingSummary extends GroupingPersistenceSummary {
  messagesConsidered: number;
  openaiRequests: 0;
  checks: GroupingProtectedChecks;
}

export interface ConversationGroupingRepository {
  loadSources(limit: number): Promise<GroupableMessage[]>;
  applyDecisions(options: {
    algorithmVersion: string;
    decisions: readonly GroupingDecision[];
  }): Promise<GroupingPersistenceSummary>;
}

export class ConversationGroupingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Conversation grouping failed.");
    this.name = "ConversationGroupingError";
    this.code = /^[A-Z0-9_]{1,64}$/.test(code)
      ? code
      : "CONVERSATION_GROUPING_ERROR";
  }
}
