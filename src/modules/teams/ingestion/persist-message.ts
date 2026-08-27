import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  MessagePersistenceOutcome,
  MessagePersistenceResult,
  NormalizedTeamsMessage,
  TeamsMessageRepository,
} from "./types";

export class TeamsMessagePersistenceError extends Error {
  readonly code: string;

  constructor(code = "DATABASE_RPC_ERROR") {
    super("Teams message persistence failed.");
    this.name = "TeamsMessagePersistenceError";
    this.code = /^[A-Z0-9_]+$/i.test(code) ? code : "DATABASE_RPC_ERROR";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResult(value: unknown): value is MessagePersistenceResult {
  return value === "inserted" || value === "updated" || value === "unchanged";
}

function parseOutcome(value: unknown): MessagePersistenceOutcome {
  if (!isRecord(value)) throw new TeamsMessagePersistenceError();
  const messageId = value.teams_message_id;
  const result = value.result;
  const contentRevision = value.content_revision;
  const attachmentsInserted = value.attachments_inserted;
  const jobsEnqueued = value.jobs_enqueued;
  if (
    typeof messageId !== "string" ||
    !isResult(result) ||
    typeof contentRevision !== "number" ||
    typeof attachmentsInserted !== "number" ||
    typeof jobsEnqueued !== "number"
  ) {
    throw new TeamsMessagePersistenceError();
  }
  return {
    messageId,
    result,
    contentRevision,
    attachmentsInserted,
    jobsEnqueued,
  };
}

function messageParameters(message: NormalizedTeamsMessage) {
  return {
    source: message.source,
    tenant_id: message.tenantId,
    team_id: message.teamId,
    channel_id: message.channelId,
    external_message_id: message.externalMessageId,
    author_teams_user_id: message.authorAadUserId,
    reply_to_external_message_id: message.rootExternalMessageId,
    source_created_at: message.sourceCreatedAt,
    source_last_modified_at: message.sourceLastModifiedAt,
    message_type: message.messageType,
    body_content_type: message.bodyContentType,
    body_content: message.bodyContent,
    source_web_url: message.sourceWebUrl,
    source_fingerprint: message.sourceFingerprint,
    observed_at: message.observedAt,
    is_bot: message.isBot,
    is_service_message: message.isServiceMessage,
  };
}

function attachmentParameters(message: NormalizedTeamsMessage) {
  return message.attachments.map((attachment) => ({
    external_attachment_id: attachment.externalAttachmentId,
    attachment_kind: attachment.attachmentKind,
    source_content_type: attachment.sourceContentType,
    file_name: attachment.fileName,
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes,
    source_locator: attachment.sourceLocator,
  }));
}

export class SupabaseTeamsMessageRepository
  implements TeamsMessageRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async persistMessage(
    message: NormalizedTeamsMessage,
  ): Promise<MessagePersistenceOutcome> {
    const { data, error } = await this.client.rpc("ingest_teams_message", {
      p_message: messageParameters(message),
      p_attachments: attachmentParameters(message),
    });
    if (error || !Array.isArray(data) || data.length !== 1) {
      throw new TeamsMessagePersistenceError(error?.code);
    }
    return parseOutcome(data[0]);
  }
}
