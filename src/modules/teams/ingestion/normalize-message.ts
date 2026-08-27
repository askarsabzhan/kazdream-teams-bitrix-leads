import "server-only";

import { createHash } from "node:crypto";

import { TEAMS_MESSAGE_SOURCE } from "../constants";

import type {
  FetchedGraphMessage,
  NormalizedTeamsAttachment,
  NormalizedTeamsMessage,
} from "./types";

const HOSTED_CONTENT_PATTERN = /\/hostedContents\/([^/"'<>\s?]+)\/?/gi;
const SENSITIVE_URL_PARAMETERS = new Set([
  "access_token",
  "authkey",
  "se",
  "sig",
  "signature",
  "sp",
  "sv",
  "token",
]);

export class TeamsMessageNormalizationError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "TeamsMessageNormalizationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sourceString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TeamsMessageNormalizationError(`INVALID_${field}`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TeamsMessageNormalizationError(`INVALID_${field}`);
  }
  return new Date(timestamp).toISOString();
}

function optionalIsoTimestamp(value: unknown, field: string): string | null {
  return value === undefined || value === null
    ? null
    : isoTimestamp(value, field);
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    for (const name of url.searchParams.keys()) {
      if (SENSITIVE_URL_PARAMETERS.has(name.toLowerCase())) return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function referenceAttachment(
  value: unknown,
): NormalizedTeamsAttachment | null {
  if (!isRecord(value)) return null;
  const rawId = nonEmptyString(value.id);
  const sourceContentType = nonEmptyString(value.contentType);
  const fileName = nonEmptyString(value.name);
  const contentUrl = safeHttpsUrl(value.contentUrl);
  const fallbackIdentity = sha256(
    JSON.stringify({
      sourceContentType,
      fileName,
      contentUrl,
    }),
  );
  const externalAttachmentId = `reference:${rawId ?? `derived:${fallbackIdentity}`}`;
  const sourceLocator: Record<string, string> = {};
  if (rawId) sourceLocator.attachment_id = rawId;
  if (contentUrl) sourceLocator.content_url = contentUrl;
  const mimeType =
    sourceContentType?.includes("/") &&
    sourceContentType.toLowerCase() !== "application/vnd.microsoft.card.codesnippet"
      ? sourceContentType
      : null;
  const sizeBytes =
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0
      ? value.size
      : null;

  return {
    externalAttachmentId,
    attachmentKind: "reference",
    sourceContentType,
    fileName,
    mimeType,
    sizeBytes,
    sourceLocator,
  };
}

function hostedAttachments(bodyContent: string | null) {
  if (bodyContent === null) return [];
  const hostedIds = new Set<string>();
  for (const match of bodyContent.matchAll(HOSTED_CONTENT_PATTERN)) {
    const rawId = match[1];
    if (!rawId) continue;
    try {
      hostedIds.add(decodeURIComponent(rawId));
    } catch {
      hostedIds.add(rawId);
    }
  }

  return [...hostedIds].map(
    (hostedContentId): NormalizedTeamsAttachment => ({
      externalAttachmentId: `hosted:${hostedContentId}`,
      attachmentKind: "hosted_content",
      sourceContentType: "chatMessageHostedContent",
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      sourceLocator: { hosted_content_id: hostedContentId },
    }),
  );
}

function normalizeAttachments(
  value: unknown,
  bodyContent: string | null,
): NormalizedTeamsAttachment[] {
  const references = Array.isArray(value)
    ? value
        .map(referenceAttachment)
        .filter(
          (attachment): attachment is NormalizedTeamsAttachment =>
            attachment !== null,
        )
    : [];

  return [...references, ...hostedAttachments(bodyContent)].sort((left, right) =>
    left.externalAttachmentId.localeCompare(right.externalAttachmentId),
  );
}

function fingerprintSource(
  message: Omit<
    NormalizedTeamsMessage,
    "observedAt" | "sourceLastModifiedAt" | "sourceFingerprint"
  >,
): string {
  return sha256(
    JSON.stringify({
      source: message.source,
      tenantId: message.tenantId,
      teamId: message.teamId,
      channelId: message.channelId,
      externalMessageId: message.externalMessageId,
      rootExternalMessageId: message.rootExternalMessageId,
      authorAadUserId: message.authorAadUserId,
      sourceCreatedAt: message.sourceCreatedAt,
      messageType: message.messageType,
      bodyContentType: message.bodyContentType,
      bodyContent: message.bodyContent,
      sourceWebUrl: message.sourceWebUrl,
      isBot: message.isBot,
      isServiceMessage: message.isServiceMessage,
    }),
  );
}

export function normalizeGraphMessage(options: {
  fetched: FetchedGraphMessage;
  tenantId: string;
  teamId: string;
  channelId: string;
  observedAt?: string;
}): NormalizedTeamsMessage {
  const { payload } = options.fetched;
  const externalMessageId = nonEmptyString(payload.id);
  if (!externalMessageId) {
    throw new TeamsMessageNormalizationError("MISSING_EXTERNAL_MESSAGE_ID");
  }

  const payloadReplyToId = nonEmptyString(payload.replyToId);
  if (
    options.fetched.rootExternalMessageId &&
    payloadReplyToId &&
    options.fetched.rootExternalMessageId !== payloadReplyToId
  ) {
    throw new TeamsMessageNormalizationError("REPLY_ROOT_MISMATCH");
  }
  const rootExternalMessageId =
    options.fetched.rootExternalMessageId ?? payloadReplyToId;
  if (rootExternalMessageId === externalMessageId) {
    throw new TeamsMessageNormalizationError("SELF_REFERENCING_REPLY");
  }

  const from = isRecord(payload.from) ? payload.from : null;
  const fromUser = from && isRecord(from.user) ? from.user : null;
  const fromApplication =
    from && isRecord(from.application) ? from.application : null;
  const body = isRecord(payload.body) ? payload.body : null;
  const bodyContent = sourceString(body?.content);
  const attachments = normalizeAttachments(payload.attachments, bodyContent);
  const messageType = nonEmptyString(payload.messageType);
  const observedAt = isoTimestamp(
    options.observedAt ?? new Date().toISOString(),
    "OBSERVED_AT",
  );
  const baseMessage = {
    source: TEAMS_MESSAGE_SOURCE,
    tenantId: options.tenantId,
    teamId: options.teamId,
    channelId: options.channelId,
    externalMessageId,
    rootExternalMessageId,
    authorAadUserId: nonEmptyString(fromUser?.id),
    sourceCreatedAt: isoTimestamp(payload.createdDateTime, "CREATED_AT"),
    messageType,
    bodyContentType: nonEmptyString(body?.contentType),
    bodyContent,
    sourceWebUrl: safeHttpsUrl(payload.webUrl),
    isBot: nonEmptyString(fromApplication?.id) !== null,
    isServiceMessage: messageType !== null && messageType !== "message",
    attachments,
  };

  return {
    ...baseMessage,
    sourceLastModifiedAt: optionalIsoTimestamp(
      payload.lastModifiedDateTime,
      "LAST_MODIFIED_AT",
    ),
    observedAt,
    sourceFingerprint: fingerprintSource(baseMessage),
  };
}
