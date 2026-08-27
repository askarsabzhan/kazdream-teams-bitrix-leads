import "server-only";

import {
  sanitizeDiagnosticText,
  sanitizeRemoteDescription,
} from "./client";
import type { GraphDiagnosticReport } from "./types";

function matrixLine(name: string, status: string): string {
  return `${name.padEnd(31)} ${status}`;
}

function booleanText(value: boolean | undefined): string {
  return value === undefined ? "not_available" : value ? "true" : "false";
}

export function formatGraphDiagnostics(
  report: GraphDiagnosticReport,
  sensitiveValues: readonly string[] = [],
): string {
  const lines = [
    "MICROSOFT_GRAPH_CAPABILITY_MATRIX",
    matrixLine("AUTH_TOKEN", report.auth.status),
    matrixLine("TEAM_DISCOVERY", report.teamDiscovery.status),
    matrixLine("CHANNEL_DISCOVERY", report.channelDiscovery.status),
    matrixLine("CHANNEL_MESSAGES_READ", report.channelMessagesRead.status),
    matrixLine("CHANNEL_REPLIES_READ", report.channelRepliesRead.status),
    matrixLine(
      "AUTHOR_AAD_ID_AVAILABLE",
      report.authorAadIdAvailable.status,
    ),
    matrixLine("FILES_READ", report.filesRead.status),
    matrixLine("IMAGE_FILE_READ", report.imageFileRead.status),
    matrixLine("AUDIO_FILE_READ", report.audioFileRead.status),
    matrixLine("HOSTED_CONTENT_READ", report.hostedContentRead.status),
    matrixLine("HISTORY_CATCHUP", report.historyCatchup.status),
    matrixLine(
      "NEW_MESSAGES_VISIBLE_IN_CATCHUP",
      report.historyCatchup.newMessagesVisible ?? "NOT_TESTED",
    ),
    matrixLine("USERS_READ", report.usersRead.status),
    matrixLine(
      "NORMAL_CHANNEL_SEND_APP_ONLY",
      report.normalChannelSendAppOnly.status,
    ),
    "",
    "SAFE_METADATA",
    `auth.endpoint=${report.auth.endpoint}`,
    `auth.token_type=${report.auth.tokenType ?? "not_available"}`,
    `auth.expires_in=${report.auth.expiresIn ?? "not_available"}`,
    `team.endpoint=${report.teamDiscovery.endpoint}`,
    `team.exact_match_count=${report.teamDiscovery.exactMatchCount ?? "not_available"}`,
    `channel.endpoint=${report.channelDiscovery.endpoint}`,
    `channel.membership_type=${report.channelDiscovery.membershipType ?? "not_available"}`,
    `channel.exact_match_count=${report.channelDiscovery.exactMatchCount ?? "not_available"}`,
    `messages.endpoint=${report.channelMessagesRead.endpoint}`,
    `messages.message_count=${report.channelMessagesRead.messageCount ?? "not_available"}`,
    `messages.has_next_link=${booleanText(report.channelMessagesRead.hasNextLink)}`,
    `messages.pagination_complete=${booleanText(report.channelMessagesRead.paginationComplete)}`,
    `replies.endpoint=${report.channelRepliesRead.endpoint}`,
    `replies.reply_count=${report.channelRepliesRead.replyCount ?? "not_available"}`,
    `replies.has_next_link=${booleanText(report.channelRepliesRead.hasNextLink)}`,
    `replies.pagination_complete=${booleanText(report.channelRepliesRead.paginationComplete)}`,
    `replies.author_identity_available=${booleanText(report.channelRepliesRead.replyAuthorIdentityAvailable)}`,
    `replies.root_association_available=${booleanText(report.channelRepliesRead.rootAssociationAvailable)}`,
    `author.inspected_message_count=${report.authorAadIdAvailable.inspectedMessageCount}`,
    `author.messages_with_aad_user_id=${report.authorAadIdAvailable.messagesWithAadUserId}`,
    `author.stable_identifier=${report.authorAadIdAvailable.status === "PASS" ? "message.from.user.id (AAD user object ID)" : "not_available"}`,
    `attachments.hosted_content=${report.filesRead.attachmentTypes.hostedContent}`,
    `attachments.reference=${report.filesRead.attachmentTypes.reference}`,
    `attachments.forwarded_message_reference=${report.filesRead.attachmentTypes.forwardedMessageReference}`,
    `attachments.unknown=${report.filesRead.attachmentTypes.unknown}`,
    `files.endpoint=${report.filesRead.endpoint}`,
    `files.content_type=${report.filesRead.contentType ?? "not_available"}`,
    `files.byte_length=${report.filesRead.byteLength ?? "not_available"}`,
    `image.representation=${report.imageFileRead.representation}`,
    `image.resource_kind=${report.imageFileRead.resourceKind ?? "not_available"}`,
    `image.content_type=${report.imageFileRead.contentType ?? "not_available"}`,
    `image.byte_length=${report.imageFileRead.byteLength ?? "not_available"}`,
    `audio.representation=${report.audioFileRead.representation}`,
    `audio.resource_kind=${report.audioFileRead.resourceKind ?? "not_available"}`,
    `audio.content_type=${report.audioFileRead.contentType ?? "not_available"}`,
    `audio.byte_length=${report.audioFileRead.byteLength ?? "not_available"}`,
    `hosted_content.endpoint=${report.hostedContentRead.endpoint}`,
    `hosted_content.detected_count=${report.hostedContentRead.detectedCount}`,
    `hosted_content.content_type=${report.hostedContentRead.contentType ?? "not_available"}`,
    `hosted_content.byte_length=${report.hostedContentRead.byteLength ?? "not_available"}`,
    `history.endpoint=${report.historyCatchup.endpoint}`,
    `history.message_count=${report.historyCatchup.messageCount ?? "not_available"}`,
    `history.date_filter_accepted=${booleanText(report.historyCatchup.dateFilterAccepted)}`,
    `history.has_next_link=${booleanText(report.historyCatchup.hasNextLink)}`,
    `history.pagination_handling_available=${booleanText(report.historyCatchup.paginationHandlingAvailable)}`,
    `history.new_messages_visible=${report.historyCatchup.newMessagesVisible ?? "NOT_TESTED"}`,
    `history.recent_target_message_count=${report.historyCatchup.recentTargetMessageCount ?? "not_available"}`,
    `history.matched_recent_target_message_count=${report.historyCatchup.matchedRecentTargetMessageCount ?? "not_available"}`,
    `users.endpoint=${report.usersRead.endpoint}`,
    `users.returned_count=${report.usersRead.returnedCount ?? "not_available"}`,
    `send.reason=${report.normalChannelSendAppOnly.reason}`,
  ];
  if (report.channelMessagesRead.fields) {
    const fields = report.channelMessagesRead.fields;
    lines.push(
      `message_shape.sample_count=${fields.sampleCount}`,
      `message_shape.id=${fields.id}/${fields.sampleCount}`,
      `message_shape.createdDateTime=${fields.createdDateTime}/${fields.sampleCount}`,
      `message_shape.lastModifiedDateTime=${fields.lastModifiedDateTime}/${fields.sampleCount}`,
      `message_shape.replyToId=${fields.replyToId}/${fields.sampleCount}`,
      `message_shape.messageType=${fields.messageType}/${fields.sampleCount}`,
      `message_shape.from_identity=${fields.fromIdentity}/${fields.sampleCount}`,
      `message_shape.attachments=${fields.attachments}/${fields.sampleCount}`,
      `message_shape.hostedContents=${fields.hostedContents}/${fields.sampleCount}`,
    );
  }
  lines.push("", "SANITIZED_ERRORS");
  if (report.errors.length === 0) lines.push("none");
  else {
    report.errors.forEach((error, index) => {
      lines.push(
        `error.${index + 1}.endpoint=${error.endpoint}`,
        `error.${index + 1}.http_status=${error.httpStatus ?? "not_available"}`,
        `error.${index + 1}.code=${error.code}`,
        `error.${index + 1}.description=${sanitizeRemoteDescription(error.description)}`,
      );
    });
  }
  const internalIdentifiers = [
    report.teamDiscovery.teamId,
    report.channelDiscovery.channelId,
    report.channelMessagesRead.sampleMessageId,
  ].filter((value): value is string => value !== undefined);

  return sanitizeDiagnosticText(lines.join("\n"), [
    ...sensitiveValues,
    ...internalIdentifiers,
  ]);
}
