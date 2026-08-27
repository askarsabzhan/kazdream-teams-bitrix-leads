import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  TEAMS_MESSAGE_JOB_TYPE,
  TEAMS_MESSAGE_SOURCE,
} from "../constants";

import type { ChannelPersistenceVerification } from "./types";

const PAGE_SIZE = 1_000;
const ID_CHUNK_SIZE = 100;

interface MessageRow {
  id: string;
  external_message_id: string;
  reply_to_external_message_id: string | null;
  author_teams_user_id: string | null;
  content_revision: number;
}

interface AttachmentRow {
  teams_message_id: string;
  external_attachment_id: string;
  is_current: boolean;
}

interface JobRow {
  aggregate_id: string;
  content_revision: number;
}

export class TeamsIngestionVerificationError extends Error {
  readonly code: string;

  constructor(code = "DATABASE_VERIFICATION_ERROR") {
    super("Teams ingestion verification failed.");
    this.name = "TeamsIngestionVerificationError";
    this.code = /^[A-Z0-9_]+$/i.test(code)
      ? code
      : "DATABASE_VERIFICATION_ERROR";
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchMessages(options: {
  client: SupabaseClient;
  source: string;
  tenantId: string;
  teamId: string;
  channelId: string;
}): Promise<MessageRow[]> {
  const rows: MessageRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await options.client
      .from("teams_messages")
      .select(
        "id,external_message_id,reply_to_external_message_id,author_teams_user_id,content_revision",
      )
      .eq("source", options.source)
      .eq("tenant_id", options.tenantId)
      .eq("team_id", options.teamId)
      .eq("channel_id", options.channelId)
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data)
      throw new TeamsIngestionVerificationError(error?.code);
    rows.push(...(data as MessageRow[]));
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function fetchAttachments(
  client: SupabaseClient,
  messageIds: readonly string[],
): Promise<AttachmentRow[]> {
  const rows: AttachmentRow[] = [];
  for (const messageIdChunk of chunks(messageIds, ID_CHUNK_SIZE)) {
    const { data, error } = await client
      .from("attachments")
      .select("teams_message_id,external_attachment_id,is_current")
      .in("teams_message_id", messageIdChunk);
    if (error || !data)
      throw new TeamsIngestionVerificationError(error?.code);
    rows.push(...(data as AttachmentRow[]));
  }
  return rows;
}

async function fetchJobs(
  client: SupabaseClient,
  messageIds: readonly string[],
): Promise<JobRow[]> {
  const rows: JobRow[] = [];
  for (const messageIdChunk of chunks(messageIds, ID_CHUNK_SIZE)) {
    const { data, error } = await client
      .from("processing_jobs")
      .select("aggregate_id,content_revision")
      .eq("job_type", TEAMS_MESSAGE_JOB_TYPE)
      .eq("aggregate_type", "teams_message")
      .in("aggregate_id", messageIdChunk);
    if (error || !data)
      throw new TeamsIngestionVerificationError(error?.code);
    rows.push(...(data as JobRow[]));
  }
  return rows;
}

function duplicateCount(values: readonly string[]): number {
  return values.length - new Set(values).size;
}

export async function verifyPersistedChannel(options: {
  client: SupabaseClient;
  tenantId: string;
  teamId: string;
  channelId: string;
}): Promise<ChannelPersistenceVerification> {
  const messages = await fetchMessages({
    ...options,
    source: TEAMS_MESSAGE_SOURCE,
  });
  const messageIds = messages.map((message) => message.id);
  const attachments = await fetchAttachments(options.client, messageIds);
  const jobs = await fetchJobs(options.client, messageIds);
  const rootExternalIds = new Set(
    messages
      .filter((message) => message.reply_to_external_message_id === null)
      .map((message) => message.external_message_id),
  );
  const currentJobKeys = new Set(
    jobs.map((job) => `${job.aggregate_id}:${job.content_revision}`),
  );
  const currentAttachments = attachments.filter(
    (attachment) => attachment.is_current,
  );

  return {
    messagesPersisted: messages.length,
    rootMessagesPersisted: rootExternalIds.size,
    repliesPersisted: messages.length - rootExternalIds.size,
    messagesWithAuthor: messages.filter(
      (message) => message.author_teams_user_id !== null,
    ).length,
    messagesWithoutAuthor: messages.filter(
      (message) => message.author_teams_user_id === null,
    ).length,
    attachmentsPersisted: currentAttachments.length,
    jobsPersisted: jobs.length,
    duplicateMessageIdentities: duplicateCount(
      messages.map((message) => message.external_message_id),
    ),
    duplicateAttachmentIdentities: duplicateCount(
      currentAttachments.map(
        (attachment) =>
          `${attachment.teams_message_id}:${attachment.external_attachment_id}`,
      ),
    ),
    duplicateJobRevisions: duplicateCount(
      jobs.map((job) => `${job.aggregate_id}:${job.content_revision}`),
    ),
    replyRelationshipsValid: messages
      .filter((message) => message.reply_to_external_message_id !== null)
      .every((message) =>
        rootExternalIds.has(message.reply_to_external_message_id as string),
      ),
    currentRevisionJobsComplete: messages.every((message) =>
      currentJobKeys.has(`${message.id}:${message.content_revision}`),
    ),
  };
}
