import "server-only";

import { ClientCredentialsTokenProvider } from "./auth";
import {
  classifyAttachmentTypes,
  classifyMediaKind,
  DRIVE_ITEM_CONTENT_ENDPOINT,
  hasHostedContentReference,
  projectGraphAttachment,
  readDriveItemReference,
  readHostedContent,
} from "./attachments";
import {
  GraphClient,
  GraphRequestError,
} from "./client";
import { collectPaginated, parseCollectionPage } from "./pagination";
import type {
  DiagnosticMessageRecord,
  GraphAttachmentRecord,
  GraphChannelRecord,
  GraphCredentials,
  GraphDiagnosticReport,
  GraphTeamRecord,
  MessageFieldAvailability,
  PaginationResult,
  SafeRemoteError,
} from "./types";

const AUTH_ENDPOINT =
  "POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
const SEND_NOT_SUPPORTED_REASON =
  "Normal channel send requires delegated ChannelMessage.Send. Application Teamwork.Migrate.All is migration-only and was not used; no write was attempted.";

export interface GraphDiagnosticOptions {
  credentials: GraphCredentials;
  teamName: string;
  channelName: string;
  fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function odataString(value: string): string {
  return value.replaceAll("'", "''");
}

function safeErrorFromUnknown(
  error: unknown,
  endpoint: string,
): SafeRemoteError {
  if (error instanceof GraphRequestError) {
    return error.safe;
  }

  return {
    endpoint,
    httpStatus: null,
    code: "DIAGNOSTIC_INTERNAL_ERROR",
    description: "The diagnostic step failed without a safe remote error.",
  };
}

function logicalError(
  endpoint: string,
  code: string,
  description: string,
): SafeRemoteError {
  return {
    endpoint,
    httpStatus: null,
    code,
    description,
  };
}

function parseTeam(value: unknown): GraphTeamRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const displayName = nonEmptyString(value.displayName);
  return id && displayName ? { id, displayName } : undefined;
}

function parseChannel(value: unknown): GraphChannelRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const displayName = nonEmptyString(value.displayName);
  const membershipType = nonEmptyString(value.membershipType);
  return id && displayName
    ? { id, displayName, ...(membershipType ? { membershipType } : {}) }
    : undefined;
}

function parseHistoryMessage(
  value: unknown,
): { id: string; channelId?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  if (!id) return undefined;
  const channelIdentity = isRecord(value.channelIdentity)
    ? value.channelIdentity
    : undefined;
  const channelId = nonEmptyString(channelIdentity?.channelId);
  return { id, ...(channelId ? { channelId } : {}) };
}

function parseMessage(
  value: unknown,
  resourcePathForId: (id: string) => string,
): DiagnosticMessageRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  if (!id) return undefined;

  const from = isRecord(value.from) ? value.from : undefined;
  const fromUser = from && isRecord(from.user) ? from.user : undefined;
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .map(projectGraphAttachment)
        .filter(
          (attachment): attachment is GraphAttachmentRecord =>
            attachment !== undefined,
        )
    : [];
  const body = isRecord(value.body) ? value.body : undefined;
  const bodyContent = nonEmptyString(body?.content);
  const createdDateTime = nonEmptyString(value.createdDateTime);
  const replyToId = nonEmptyString(value.replyToId);
  const hostedContents = Array.isArray(value.hostedContents)
    ? value.hostedContents
    : [];

  return {
    id,
    resourcePath: resourcePathForId(id),
    ...(createdDateTime ? { createdDateTime } : {}),
    ...(replyToId ? { replyToId } : {}),
    fieldPresence: {
      id: hasOwn(value, "id") ? 1 : 0,
      createdDateTime: hasOwn(value, "createdDateTime") ? 1 : 0,
      lastModifiedDateTime: hasOwn(value, "lastModifiedDateTime") ? 1 : 0,
      replyToId: hasOwn(value, "replyToId") ? 1 : 0,
      messageType: hasOwn(value, "messageType") ? 1 : 0,
      fromIdentity: from ? 1 : 0,
      attachments: hasOwn(value, "attachments") ? 1 : 0,
      hostedContents: hasOwn(value, "hostedContents") ? 1 : 0,
    },
    aadUserIdAvailable: nonEmptyString(fromUser?.id) !== undefined,
    attachments,
    hostedContentReferencePresent: hasHostedContentReference(
      bodyContent,
      hostedContents,
    ),
  };
}

function summarizeFields(
  messages: readonly DiagnosticMessageRecord[],
): MessageFieldAvailability {
  const summary: MessageFieldAvailability = {
    sampleCount: messages.length,
    id: 0,
    createdDateTime: 0,
    lastModifiedDateTime: 0,
    replyToId: 0,
    messageType: 0,
    fromIdentity: 0,
    attachments: 0,
    hostedContents: 0,
  };
  for (const message of messages) {
    summary.id += message.fieldPresence.id;
    summary.createdDateTime += message.fieldPresence.createdDateTime;
    summary.lastModifiedDateTime += message.fieldPresence.lastModifiedDateTime;
    summary.replyToId += message.fieldPresence.replyToId;
    summary.messageType += message.fieldPresence.messageType;
    summary.fromIdentity += message.fieldPresence.fromIdentity;
    summary.attachments += message.fieldPresence.attachments;
    summary.hostedContents += message.fieldPresence.hostedContents;
  }
  return summary;
}

function authFailedReport(
  auth: GraphDiagnosticReport["auth"],
  errors: SafeRemoteError[],
): GraphDiagnosticReport {
  const status = "NOT_TESTED_AUTH_FAILED" as const;
  return {
    auth,
    teamDiscovery: {
      status,
      endpoint: "GET /teams (bounded exact-name filter)",
    },
    channelDiscovery: {
      status,
      endpoint: "GET /teams/{team-id}/channels",
    },
    channelMessagesRead: {
      status,
      endpoint: "GET /teams/{team-id}/channels/{channel-id}/messages",
    },
    channelRepliesRead: {
      status,
      endpoint:
        "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies",
    },
    authorAadIdAvailable: {
      status,
      inspectedMessageCount: 0,
      messagesWithAadUserId: 0,
    },
    filesRead: {
      status,
      endpoint: "GET /shares/{encoded-sharing-url}/driveItem/content",
      attachmentTypes: {
        hostedContent: 0,
        reference: 0,
        forwardedMessageReference: 0,
        unknown: 0,
      },
    },
    imageFileRead: {
      status,
      representation: "not_tested_auth_failed",
    },
    audioFileRead: {
      status,
      representation: "not_tested_auth_failed",
    },
    hostedContentRead: {
      status,
      endpoint:
        "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents/{hosted-content-id}/$value",
      detectedCount: 0,
    },
    historyCatchup: {
      status,
      endpoint: "GET /teams/{team-id}/channels/getAllMessages",
      paginationHandlingAvailable: true,
    },
    usersRead: { status, endpoint: "GET /users?$select=id&$top=1" },
    normalChannelSendAppOnly: {
      status: "NOT_SUPPORTED",
      reason: SEND_NOT_SUPPORTED_REASON,
    },
    errors,
  };
}

export async function runGraphDiagnostics(
  options: GraphDiagnosticOptions,
): Promise<GraphDiagnosticReport> {
  const diagnosticStartedAt = Date.now();
  const errors: SafeRemoteError[] = [];
  const tokenProvider = new ClientCredentialsTokenProvider(options.credentials, {
    ...(options.fetchImplementation
      ? { fetchImplementation: options.fetchImplementation }
      : {}),
  });

  let token;
  try {
    token = await tokenProvider.getToken();
  } catch (error) {
    const safeError = safeErrorFromUnknown(error, AUTH_ENDPOINT);
    errors.push(safeError);
    return authFailedReport(
      { status: "FAIL", endpoint: AUTH_ENDPOINT, error: safeError },
      errors,
    );
  }

  const auth: GraphDiagnosticReport["auth"] = {
    status: "PASS",
    endpoint: AUTH_ENDPOINT,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
  };
  const client = new GraphClient(() => tokenProvider.getAccessToken(), {
    ...(options.fetchImplementation
      ? { fetchImplementation: options.fetchImplementation }
      : {}),
  });

  const teamSafeEndpoint = "GET /teams (bounded exact-name filter)";
  const teamQuery = new URLSearchParams({
    $filter: `displayName eq '${odataString(options.teamName)}'`,
    $select: "id,displayName",
    $top: "20",
  });
  let team: GraphTeamRecord | undefined;
  let teamDiscovery: GraphDiagnosticReport["teamDiscovery"];
  try {
    const teams = await collectPaginated({
      initialEndpoint: `/teams?${teamQuery.toString()}`,
      maxPages: 5,
      maxItems: 100,
      fetchPage: async (endpoint) =>
        parseCollectionPage(
          await client.getJson(endpoint, teamSafeEndpoint),
          parseTeam,
          teamSafeEndpoint,
        ),
    });
    const exactMatches = teams.items.filter(
      (candidate) => candidate.displayName === options.teamName,
    );
    if (exactMatches.length !== 1) {
      const error = logicalError(
        teamSafeEndpoint,
        exactMatches.length === 0 ? "TEAM_NOT_FOUND" : "TEAM_NAME_AMBIGUOUS",
        `Expected one exact team match; found ${exactMatches.length}.`,
      );
      errors.push(error);
      teamDiscovery = {
        status: "FAIL",
        endpoint: teamSafeEndpoint,
        exactMatchCount: exactMatches.length,
        error,
      };
    } else {
      [team] = exactMatches;
      teamDiscovery = {
        status: "PASS",
        endpoint: teamSafeEndpoint,
        teamId: team.id,
        exactMatchCount: 1,
      };
    }
  } catch (error) {
    const safeError = safeErrorFromUnknown(error, teamSafeEndpoint);
    errors.push(safeError);
    teamDiscovery = {
      status: "FAIL",
      endpoint: teamSafeEndpoint,
      error: safeError,
    };
  }

  let channel: GraphChannelRecord | undefined;
  let channelDiscovery: GraphDiagnosticReport["channelDiscovery"];
  if (!team) {
    channelDiscovery = {
      status: "NOT_TESTED_PREREQUISITE_FAILED",
      endpoint: "GET /teams/{team-id}/channels",
    };
  } else {
    const channelSafeEndpoint = "GET /teams/{team-id}/channels";
    const channelQuery = new URLSearchParams({
      $select: "id,displayName,membershipType",
    });
    try {
      const channels = await collectPaginated({
        initialEndpoint: `/teams/${segment(team.id)}/channels?${channelQuery.toString()}`,
        maxPages: 20,
        maxItems: 1_000,
        fetchPage: async (endpoint) =>
          parseCollectionPage(
            await client.getJson(endpoint, channelSafeEndpoint),
            parseChannel,
            channelSafeEndpoint,
          ),
      });
      const exactMatches = channels.items.filter(
        (candidate) => candidate.displayName === options.channelName,
      );
      if (exactMatches.length !== 1) {
        const error = logicalError(
          channelSafeEndpoint,
          exactMatches.length === 0
            ? "CHANNEL_NOT_FOUND"
            : "CHANNEL_NAME_AMBIGUOUS",
          `Expected one exact channel match; found ${exactMatches.length}.`,
        );
        errors.push(error);
        channelDiscovery = {
          status: "FAIL",
          endpoint: channelSafeEndpoint,
          exactMatchCount: exactMatches.length,
          error,
        };
      } else {
        [channel] = exactMatches;
        channelDiscovery = {
          status: "PASS",
          endpoint: channelSafeEndpoint,
          channelId: channel.id,
          ...(channel.membershipType
            ? { membershipType: channel.membershipType }
            : {}),
          exactMatchCount: 1,
        };
      }
    } catch (error) {
      const safeError = safeErrorFromUnknown(error, channelSafeEndpoint);
      errors.push(safeError);
      channelDiscovery = {
        status: "FAIL",
        endpoint: channelSafeEndpoint,
        error: safeError,
      };
    }
  }

  let rootMessages: DiagnosticMessageRecord[] = [];
  let channelMessagesRead: GraphDiagnosticReport["channelMessagesRead"];
  if (!team || !channel) {
    channelMessagesRead = {
      status: "NOT_TESTED_PREREQUISITE_FAILED",
      endpoint: "GET /teams/{team-id}/channels/{channel-id}/messages",
    };
  } else {
    const messageSafeEndpoint =
      "GET /teams/{team-id}/channels/{channel-id}/messages";
    const messageEndpoint = `/teams/${segment(team.id)}/channels/${segment(channel.id)}/messages?$top=50`;
    try {
      const messages = await collectPaginated({
        initialEndpoint: messageEndpoint,
        maxPages: 100,
        maxItems: 5_000,
        fetchPage: async (endpoint) =>
          parseCollectionPage(
            await client.getJson(endpoint, messageSafeEndpoint),
            (item) =>
              parseMessage(
                item,
                (messageId) =>
                  `/teams/${segment(team.id)}/channels/${segment(channel.id)}/messages/${segment(messageId)}`,
              ),
            messageSafeEndpoint,
          ),
      });
      rootMessages = messages.items;
      channelMessagesRead = {
        status: "PASS",
        endpoint: messageSafeEndpoint,
        messageCount: rootMessages.length,
        hasNextLink: messages.initialHadNextLink,
        paginationComplete: messages.complete,
        ...(rootMessages[0] ? { sampleMessageId: rootMessages[0].id } : {}),
        fields: summarizeFields(rootMessages),
      };
    } catch (error) {
      const safeError = safeErrorFromUnknown(error, messageSafeEndpoint);
      errors.push(safeError);
      channelMessagesRead = {
        status: "FAIL",
        endpoint: messageSafeEndpoint,
        error: safeError,
      };
    }
  }

  let replies: DiagnosticMessageRecord[] = [];
  let channelRepliesRead: GraphDiagnosticReport["channelRepliesRead"];
  if (channelMessagesRead.status !== "PASS") {
    channelRepliesRead = {
      status: "NOT_TESTED_PREREQUISITE_FAILED",
      endpoint:
        "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies",
    };
  } else if (!team || !channel || rootMessages.length === 0) {
    channelRepliesRead = {
      status: "NOT_TESTED_NO_MESSAGE",
      endpoint:
        "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies",
    };
  } else {
    const replySafeEndpoint =
      "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies";
    try {
      let matchedReplyResult:
        | PaginationResult<DiagnosticMessageRecord>
        | undefined;

      for (const rootMessage of rootMessages.slice(0, 25)) {
        const replyResult = await collectPaginated({
          initialEndpoint: `${rootMessage.resourcePath}/replies?$top=50`,
          maxPages: 20,
          maxItems: 1_000,
          fetchPage: async (endpoint) =>
            parseCollectionPage(
              await client.getJson(endpoint, replySafeEndpoint),
              (item) =>
                parseMessage(
                  item,
                  (replyId) =>
                    `${rootMessage.resourcePath}/replies/${segment(replyId)}`,
                ),
              replySafeEndpoint,
            ),
        });
        if (replyResult.items.length > 0) {
          matchedReplyResult = replyResult;
          break;
        }
      }

      if (!matchedReplyResult) {
        const error = logicalError(
          replySafeEndpoint,
          "REPLY_NOT_FOUND_IN_BOUNDED_SAMPLE",
          "No reply was found in the bounded root-message sample.",
        );
        errors.push(error);
        channelRepliesRead = {
          status: "FAIL",
          endpoint: replySafeEndpoint,
          replyCount: 0,
          error,
        };
      } else {
        replies = matchedReplyResult.items;
        channelRepliesRead = {
          status: "PASS",
          endpoint: replySafeEndpoint,
          replyCount: replies.length,
          hasNextLink: matchedReplyResult.initialHadNextLink,
          paginationComplete: matchedReplyResult.complete,
          replyAuthorIdentityAvailable: replies.some(
            (reply) => reply.aadUserIdAvailable,
          ),
          rootAssociationAvailable: true,
        };
      }
    } catch (error) {
      const safeError = safeErrorFromUnknown(error, replySafeEndpoint);
      errors.push(safeError);
      channelRepliesRead = {
        status: "FAIL",
        endpoint: replySafeEndpoint,
        error: safeError,
      };
    }
  }

  const inspectedMessages = [...rootMessages, ...replies];
  if (channelMessagesRead.status === "PASS")
    channelMessagesRead.fields = summarizeFields(inspectedMessages);
  const messagesWithAadUserId = inspectedMessages.filter(
    (message) => message.aadUserIdAvailable,
  ).length;
  const authorAadIdAvailable: GraphDiagnosticReport["authorAadIdAvailable"] =
    inspectedMessages.length === 0
      ? {
          status: "NOT_TESTED_NO_MESSAGE",
          inspectedMessageCount: 0,
          messagesWithAadUserId: 0,
        }
      : {
          status: messagesWithAadUserId > 0 ? "PASS" : "FAIL",
          inspectedMessageCount: inspectedMessages.length,
          messagesWithAadUserId,
        };

  const attachmentTypes = classifyAttachmentTypes(inspectedMessages);
  const referenceAttachments = inspectedMessages
    .flatMap((message) => message.attachments)
    .filter((attachment) => attachment.contentType.toLowerCase() === "reference");
  let imageFileRead: GraphDiagnosticReport["imageFileRead"] = {
    status: "NOT_TESTED_NO_ATTACHMENT",
    representation: "not_detected",
  };
  let audioFileRead: GraphDiagnosticReport["audioFileRead"] = {
    status: "NOT_TESTED_NO_ATTACHMENT",
    representation: "not_detected",
  };
  const successfulReferenceReads: Array<{
    contentType: string;
    byteLength: number;
    mediaKind?: "image" | "audio";
  }> = [];
  let firstReferenceError: SafeRemoteError | undefined;

  for (const attachment of referenceAttachments) {
    try {
      const result = await readDriveItemReference(client, attachment);
      const success = {
        status: "PASS" as const,
        representation:
          "chatMessageAttachment(reference) -> SharePoint/OneDrive DriveItem",
        resourceKind: "driveItem_reference",
        contentType: result.contentType,
        byteLength: result.byteLength,
      };

      successfulReferenceReads.push(result);
      if (result.mediaKind === "image") imageFileRead = success;
      if (result.mediaKind === "audio") audioFileRead = success;
    } catch (error) {
      const safeError = safeErrorFromUnknown(
        error,
        DRIVE_ITEM_CONTENT_ENDPOINT,
      );
      errors.push(safeError);
      firstReferenceError ??= safeError;
      const failedMedia = {
        status: "FAIL" as const,
        representation:
          attachment.contentUrl
            ? "chatMessageAttachment(reference) -> SharePoint/OneDrive DriveItem"
            : "chatMessageAttachment(reference) -> unresolved DriveItem",
        resourceKind: "driveItem_reference",
        error: safeError,
      };
      if (attachment.mediaKindHint === "image") imageFileRead = failedMedia;
      if (attachment.mediaKindHint === "audio") audioFileRead = failedMedia;
    }
  }

  let filesRead: GraphDiagnosticReport["filesRead"];
  if (referenceAttachments.length === 0) {
    filesRead = {
      status: "NOT_TESTED_NO_ATTACHMENT",
      endpoint: DRIVE_ITEM_CONTENT_ENDPOINT,
      attachmentTypes,
    };
  } else if (successfulReferenceReads.length > 0) {
    filesRead = {
      status: "PASS",
      endpoint: DRIVE_ITEM_CONTENT_ENDPOINT,
      attachmentTypes,
      contentType: successfulReferenceReads[0].contentType,
      byteLength: successfulReferenceReads[0].byteLength,
    };
  } else {
    filesRead = {
      status: "FAIL",
      endpoint: DRIVE_ITEM_CONTENT_ENDPOINT,
      attachmentTypes,
      ...(firstReferenceError ? { error: firstReferenceError } : {}),
    };
  }

  const hostedCandidate = inspectedMessages.find(
    (message) => message.hostedContentReferencePresent,
  );
  let hostedContentRead: GraphDiagnosticReport["hostedContentRead"];
  if (!hostedCandidate) {
    hostedContentRead = {
      status: "NOT_TESTED",
      endpoint:
        "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents/{hosted-content-id}/$value",
      detectedCount: 0,
    };
  } else {
    const listSafeEndpoint =
      "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents";
    try {
      const hosted = await readHostedContent(
        client,
        hostedCandidate.resourcePath,
      );
      hostedContentRead = {
        status: "PASS",
        endpoint: hosted.endpoint,
        detectedCount: hosted.detectedCount,
        contentType: hosted.contentType,
        byteLength: hosted.byteLength,
      };
      const hostedMedia = {
        status: "PASS" as const,
        representation:
          "message body hosted content -> chatMessageHostedContent",
        resourceKind: "chatMessageHostedContent",
        contentType: hosted.contentType,
        byteLength: hosted.byteLength,
      };
      const hostedMediaKind = classifyMediaKind(hosted.contentType);
      if (hostedMediaKind === "image") imageFileRead = hostedMedia;
      if (hostedMediaKind === "audio") audioFileRead = hostedMedia;
    } catch (error) {
      const safeError = safeErrorFromUnknown(error, listSafeEndpoint);
      errors.push(safeError);
      hostedContentRead = {
        status: "FAIL",
        endpoint: listSafeEndpoint,
        detectedCount: 1,
        error: safeError,
      };
    }
  }

  let historyCatchup: GraphDiagnosticReport["historyCatchup"];
  if (!team || !channel) {
    historyCatchup = {
      status: "NOT_TESTED_PREREQUISITE_FAILED",
      endpoint: "GET /teams/{team-id}/channels/getAllMessages",
      paginationHandlingAvailable: true,
    };
  } else {
    const lowerBound = new Date(
      diagnosticStartedAt - 48 * 60 * 60 * 1_000,
    ).toISOString();
    const upperBound = new Date(
      diagnosticStartedAt + 5 * 60 * 1_000,
    ).toISOString();
    const recentTargetMessages = inspectedMessages.filter((message) => {
      if (!message.createdDateTime) return false;
      const createdAt = Date.parse(message.createdDateTime);
      return (
        Number.isFinite(createdAt) &&
        createdAt > Date.parse(lowerBound) &&
        createdAt < Date.parse(upperBound)
      );
    });
    const historySafeEndpoint =
      "GET /teams/{team-id}/channels/getAllMessages ($top=50, bounded recent date filter)";
    const historyQuery = new URLSearchParams({
      $top: "50",
      $filter:
        `lastModifiedDateTime gt ${lowerBound} and lastModifiedDateTime lt ${upperBound}`,
    });
    try {
      const history = await collectPaginated({
        initialEndpoint: `/teams/${segment(team.id)}/channels/getAllMessages?${historyQuery.toString()}`,
        maxPages: 10,
        maxItems: 500,
        fetchPage: async (endpoint) =>
          parseCollectionPage(
            await client.getJson(endpoint, historySafeEndpoint),
            parseHistoryMessage,
            historySafeEndpoint,
          ),
      });
      const targetHistoryIds = new Set(
        history.items
          .filter((message) => message.channelId === channel.id)
          .map((message) => message.id),
      );
      const matchedRecentTargetMessageCount = recentTargetMessages.filter(
        (message) => targetHistoryIds.has(message.id),
      ).length;
      const newMessagesVisible =
        recentTargetMessages.length > 0 &&
        matchedRecentTargetMessageCount === recentTargetMessages.length
          ? "PASS"
          : "FAIL";
      historyCatchup = {
        status: "PASS",
        endpoint: historySafeEndpoint,
        messageCount: history.items.length,
        dateFilterAccepted: true,
        hasNextLink: history.initialHadNextLink,
        paginationHandlingAvailable: true,
        newMessagesVisible,
        recentTargetMessageCount: recentTargetMessages.length,
        matchedRecentTargetMessageCount,
      };
    } catch (error) {
      const safeError = safeErrorFromUnknown(error, historySafeEndpoint);
      errors.push(safeError);
      historyCatchup = {
        status: "FAIL",
        endpoint: historySafeEndpoint,
        dateFilterAccepted: false,
        paginationHandlingAvailable: true,
        error: safeError,
      };
    }
  }

  const usersSafeEndpoint = "GET /users?$select=id&$top=1";
  let usersRead: GraphDiagnosticReport["usersRead"];
  try {
    const page = parseCollectionPage(
      await client.getJson("/users?$select=id&$top=1", usersSafeEndpoint),
      (item) =>
        isRecord(item) && nonEmptyString(item.id) ? true : undefined,
      usersSafeEndpoint,
    );
    usersRead = {
      status: "PASS",
      endpoint: usersSafeEndpoint,
      returnedCount: page.value.length,
    };
  } catch (error) {
    const safeError = safeErrorFromUnknown(error, usersSafeEndpoint);
    errors.push(safeError);
    usersRead = {
      status: "FAIL",
      endpoint: usersSafeEndpoint,
      error: safeError,
    };
  }

  return {
    auth,
    teamDiscovery,
    channelDiscovery,
    channelMessagesRead,
    channelRepliesRead,
    authorAadIdAvailable,
    filesRead,
    imageFileRead,
    audioFileRead,
    hostedContentRead,
    historyCatchup,
    usersRead,
    normalChannelSendAppOnly: {
      status: "NOT_SUPPORTED",
      reason: SEND_NOT_SUPPORTED_REASON,
    },
    errors,
  };
}
