export type TeamsIngestionMode = "latest" | "catch-up";
export type MessagePersistenceResult = "inserted" | "updated" | "unchanged";
export type AttachmentKind = "hosted_content" | "reference";

export interface NormalizedTeamsAttachment {
  externalAttachmentId: string;
  attachmentKind: AttachmentKind;
  sourceContentType: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceLocator: Record<string, string>;
}

export interface NormalizedTeamsMessage {
  source: "microsoft_teams";
  tenantId: string;
  teamId: string;
  channelId: string;
  externalMessageId: string;
  rootExternalMessageId: string | null;
  authorAadUserId: string | null;
  sourceCreatedAt: string;
  sourceLastModifiedAt: string | null;
  messageType: string | null;
  bodyContentType: string | null;
  bodyContent: string | null;
  sourceWebUrl: string | null;
  observedAt: string;
  isBot: boolean;
  isServiceMessage: boolean;
  sourceFingerprint: string;
  attachments: NormalizedTeamsAttachment[];
}

export interface FetchedGraphMessage {
  payload: Record<string, unknown>;
  rootExternalMessageId: string | null;
}

export interface ResolvedTeamsChannel {
  teamId: string;
  channelId: string;
  membershipType: string | null;
}

export interface FetchedTeamsBatch {
  channel: ResolvedTeamsChannel;
  messages: FetchedGraphMessage[];
  rootMessagesSeen: number;
  repliesSeen: number;
}

export interface MessagePersistenceOutcome {
  messageId: string;
  result: MessagePersistenceResult;
  contentRevision: number;
  attachmentsInserted: number;
  jobsEnqueued: number;
}

export interface TeamsMessageRepository {
  persistMessage(
    message: NormalizedTeamsMessage,
  ): Promise<MessagePersistenceOutcome>;
}

export interface IngestionSummary {
  mode: TeamsIngestionMode;
  dryRun: boolean;
  messagesSeen: number;
  rootMessagesSeen: number;
  repliesSeen: number;
  messagesInserted: number;
  messagesUpdated: number;
  messagesUnchanged: number;
  attachmentsSeen: number;
  hostedAttachmentsSeen: number;
  referenceAttachmentsSeen: number;
  attachmentsInserted: number;
  jobsEnqueued: number;
}

export interface ChannelPersistenceVerification {
  messagesPersisted: number;
  rootMessagesPersisted: number;
  repliesPersisted: number;
  messagesWithAuthor: number;
  messagesWithoutAuthor: number;
  attachmentsPersisted: number;
  jobsPersisted: number;
  duplicateMessageIdentities: number;
  duplicateAttachmentIdentities: number;
  duplicateJobRevisions: number;
  replyRelationshipsValid: boolean;
  currentRevisionJobsComplete: boolean;
}
