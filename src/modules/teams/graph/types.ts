export type DiagnosticStatus =
  | "PASS"
  | "FAIL"
  | "NOT_TESTED"
  | "NOT_TESTED_AUTH_FAILED"
  | "NOT_TESTED_NO_ATTACHMENT"
  | "NOT_TESTED_NO_MESSAGE"
  | "NOT_TESTED_PREREQUISITE_FAILED";

export type SendCapabilityStatus =
  | "SUPPORTED"
  | "NOT_SUPPORTED"
  | "UNRESOLVED";

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface GraphAccessToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
}

export interface SafeRemoteError {
  endpoint: string;
  httpStatus: number | null;
  code: string;
  description: string;
}

export interface GraphCollectionPage<T> {
  value: T[];
  nextLink?: string;
}

export interface PaginationResult<T> {
  items: T[];
  pageCount: number;
  initialHadNextLink: boolean;
  complete: boolean;
  remainingNextLink?: string;
}

export interface MessageFieldAvailability {
  sampleCount: number;
  id: number;
  createdDateTime: number;
  lastModifiedDateTime: number;
  replyToId: number;
  messageType: number;
  fromIdentity: number;
  attachments: number;
  hostedContents: number;
}

export interface AttachmentTypeCounts {
  hostedContent: number;
  reference: number;
  forwardedMessageReference: number;
  unknown: number;
}

export interface AuthDiagnostic {
  status: "PASS" | "FAIL";
  endpoint: string;
  tokenType?: string;
  expiresIn?: number;
  error?: SafeRemoteError;
}

export interface TeamDiscoveryDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  teamId?: string;
  exactMatchCount?: number;
  error?: SafeRemoteError;
}

export interface ChannelDiscoveryDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  channelId?: string;
  membershipType?: string;
  exactMatchCount?: number;
  error?: SafeRemoteError;
}

export interface MessageReadDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  messageCount?: number;
  hasNextLink?: boolean;
  paginationComplete?: boolean;
  sampleMessageId?: string;
  fields?: MessageFieldAvailability;
  error?: SafeRemoteError;
}

export interface ReplyReadDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  replyCount?: number;
  hasNextLink?: boolean;
  paginationComplete?: boolean;
  replyAuthorIdentityAvailable?: boolean;
  rootAssociationAvailable?: boolean;
  error?: SafeRemoteError;
}

export interface AuthorDiagnostic {
  status: DiagnosticStatus;
  inspectedMessageCount: number;
  messagesWithAadUserId: number;
}

export interface FileReadDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  attachmentTypes: AttachmentTypeCounts;
  contentType?: string;
  byteLength?: number;
  error?: SafeRemoteError;
}

export interface HostedContentDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  detectedCount: number;
  contentType?: string;
  byteLength?: number;
  error?: SafeRemoteError;
}

export interface MediaReadDiagnostic {
  status: DiagnosticStatus;
  representation: string;
  resourceKind?: string;
  contentType?: string;
  byteLength?: number;
  error?: SafeRemoteError;
}

export interface HistoryDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  messageCount?: number;
  dateFilterAccepted?: boolean;
  hasNextLink?: boolean;
  paginationHandlingAvailable: boolean;
  newMessagesVisible?: DiagnosticStatus;
  recentTargetMessageCount?: number;
  matchedRecentTargetMessageCount?: number;
  error?: SafeRemoteError;
}

export interface UsersReadDiagnostic {
  status: DiagnosticStatus;
  endpoint: string;
  returnedCount?: number;
  error?: SafeRemoteError;
}

export interface SendCapabilityDiagnostic {
  status: SendCapabilityStatus;
  reason: string;
}

export interface GraphDiagnosticReport {
  auth: AuthDiagnostic;
  teamDiscovery: TeamDiscoveryDiagnostic;
  channelDiscovery: ChannelDiscoveryDiagnostic;
  channelMessagesRead: MessageReadDiagnostic;
  channelRepliesRead: ReplyReadDiagnostic;
  authorAadIdAvailable: AuthorDiagnostic;
  filesRead: FileReadDiagnostic;
  imageFileRead: MediaReadDiagnostic;
  audioFileRead: MediaReadDiagnostic;
  hostedContentRead: HostedContentDiagnostic;
  historyCatchup: HistoryDiagnostic;
  usersRead: UsersReadDiagnostic;
  normalChannelSendAppOnly: SendCapabilityDiagnostic;
  errors: SafeRemoteError[];
}

export interface GraphTeamRecord {
  id: string;
  displayName: string;
}

export interface GraphChannelRecord {
  id: string;
  displayName: string;
  membershipType?: string;
}

export interface GraphAttachmentRecord {
  contentType: string;
  contentUrl?: string;
  mediaKindHint?: "image" | "audio";
}

export interface DiagnosticMessageRecord {
  id: string;
  resourcePath: string;
  createdDateTime?: string;
  replyToId?: string;
  fieldPresence: Omit<MessageFieldAvailability, "sampleCount">;
  aadUserIdAvailable: boolean;
  attachments: GraphAttachmentRecord[];
  hostedContentReferencePresent: boolean;
}
