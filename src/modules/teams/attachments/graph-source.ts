import "server-only";

import {
  DRIVE_ITEM_CONTENT_ENDPOINT,
  resolveDriveItemReference,
} from "../graph/attachments";
import { GraphClient, GraphRequestError } from "../graph/client";
import { collectPaginated, parseCollectionPage } from "../graph/pagination";
import type { GraphAttachmentRecord } from "../graph/types";

import {
  IMAGE_MAX_BYTES,
  maximumBytesForClaim,
  maximumBytesForDeclaredMime,
} from "./content-validation";
import {
  AttachmentAcquisitionError,
  type AttachmentAcquisitionClaim,
  type AttachmentByteSource,
  type DownloadedAttachment,
} from "./types";

const HOSTED_CONTENT_BYTES_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents/{hosted-content-id}/$value";
const SOURCE_MESSAGE_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}?$select=id,attachments";
const SOURCE_REPLY_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{root-id}/replies/{reply-id}?$select=id,attachments";
const SOURCE_MESSAGE_LIST_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages (bounded identity fallback)";
const SOURCE_REPLY_LIST_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{root-id}/replies (bounded identity fallback)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function messageResourcePath(claim: AttachmentAcquisitionClaim): string {
  const channelPath = `/teams/${segment(claim.teamId)}/channels/${segment(claim.channelId)}/messages`;
  return claim.rootExternalMessageId
    ? `${channelPath}/${segment(claim.rootExternalMessageId)}/replies/${segment(claim.externalMessageId)}`
    : `${channelPath}/${segment(claim.externalMessageId)}`;
}

function mapGraphError(error: GraphRequestError): AttachmentAcquisitionError {
  if (error.safe.code === "FILE_TOO_LARGE") {
    return new AttachmentAcquisitionError(
      "FILE_TOO_LARGE",
      "permanent_failed",
    );
  }
  if (error.safe.httpStatus === 404) {
    return new AttachmentAcquisitionError(
      "GRAPH_ATTACHMENT_NOT_FOUND",
      "permanent_failed",
    );
  }
  return new AttachmentAcquisitionError(
    error.safe.code,
    "retryable_failed",
  );
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function graphMessage(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) && safeString(value.id) ? value : undefined;
}

async function refetchSourceMessage(
  client: GraphClient,
  claim: AttachmentAcquisitionClaim,
): Promise<unknown> {
  const resourcePath = messageResourcePath(claim);
  try {
    return await client.getJson(
      `${resourcePath}?$select=id,attachments`,
      claim.rootExternalMessageId
        ? SOURCE_REPLY_ENDPOINT
        : SOURCE_MESSAGE_ENDPOINT,
    );
  } catch (error) {
    if (
      !(error instanceof GraphRequestError) ||
      (error.safe.code !== "INVALID_JSON_RESPONSE" &&
        error.safe.httpStatus !== 404)
    ) {
      throw error;
    }
  }

  // Some channel-message fixtures return an empty successful response for the
  // item endpoint while remaining present in the collection projection. Use a
  // bounded identity lookup rather than falling back to a persisted URL.
  const messageListPath = claim.rootExternalMessageId
    ? `/teams/${segment(claim.teamId)}/channels/${segment(claim.channelId)}/messages/${segment(claim.rootExternalMessageId)}/replies?$top=50`
    : `/teams/${segment(claim.teamId)}/channels/${segment(claim.channelId)}/messages?$top=50`;
  const safeEndpoint = claim.rootExternalMessageId
    ? SOURCE_REPLY_LIST_ENDPOINT
    : SOURCE_MESSAGE_LIST_ENDPOINT;
  const messages = await collectPaginated({
    initialEndpoint: messageListPath,
    maxPages: 20,
    maxItems: 1_000,
    fetchPage: async (endpoint) =>
      parseCollectionPage(
        await client.getJson(endpoint, safeEndpoint),
        graphMessage,
        safeEndpoint,
      ),
  });
  const matched = messages.items.find(
    (message) => message.id === claim.externalMessageId,
  );
  if (!matched) {
    throw new AttachmentAcquisitionError(
      "GRAPH_ATTACHMENT_NOT_FOUND",
      "permanent_failed",
    );
  }
  return matched;
}

function referenceFromMessage(
  value: unknown,
  attachmentId: string,
): GraphAttachmentRecord {
  if (!isRecord(value) || !Array.isArray(value.attachments)) {
    throw new AttachmentAcquisitionError(
      "REFERENCE_ATTACHMENT_NOT_RESOLVED",
      "permanent_failed",
    );
  }
  const attachment = value.attachments.find(
    (candidate) => isRecord(candidate) && candidate.id === attachmentId,
  );
  if (!isRecord(attachment)) {
    throw new AttachmentAcquisitionError(
      "REFERENCE_ATTACHMENT_NOT_RESOLVED",
      "permanent_failed",
    );
  }
  const contentUrl = safeString(attachment.contentUrl);
  if (!contentUrl) {
    throw new AttachmentAcquisitionError(
      "REFERENCE_CONTENT_URL_MISSING",
      "permanent_failed",
    );
  }
  return {
    contentType: safeString(attachment.contentType) ?? "reference",
    contentUrl,
  };
}

export class GraphAttachmentByteSource implements AttachmentByteSource {
  constructor(
    private readonly client: GraphClient,
    private readonly expectedTenantId: string,
  ) {}

  async download(
    claim: AttachmentAcquisitionClaim,
  ): Promise<DownloadedAttachment> {
    if (claim.tenantId !== this.expectedTenantId) {
      throw new AttachmentAcquisitionError(
        "TENANT_MISMATCH",
        "retryable_failed",
      );
    }

    try {
      return claim.attachmentKind === "hosted_content"
        ? await this.downloadHostedContent(claim)
        : await this.downloadReference(claim);
    } catch (error) {
      if (error instanceof AttachmentAcquisitionError) throw error;
      if (error instanceof GraphRequestError) throw mapGraphError(error);
      throw new AttachmentAcquisitionError(
        "GRAPH_ATTACHMENT_DOWNLOAD_FAILED",
        "retryable_failed",
      );
    }
  }

  private async downloadHostedContent(
    claim: AttachmentAcquisitionClaim,
  ): Promise<DownloadedAttachment> {
    const hostedContentId = claim.sourceLocator.hosted_content_id;
    if (!hostedContentId) {
      throw new AttachmentAcquisitionError(
        "HOSTED_CONTENT_ID_MISSING",
        "permanent_failed",
      );
    }
    const result = await this.client.getBoundedBytes(
      `${messageResourcePath(claim)}/hostedContents/${segment(hostedContentId)}/$value`,
      HOSTED_CONTENT_BYTES_ENDPOINT,
      IMAGE_MAX_BYTES,
    );
    return {
      bytes: result.bytes,
      declaredMimeType: result.contentType,
    };
  }

  private async downloadReference(
    claim: AttachmentAcquisitionClaim,
  ): Promise<DownloadedAttachment> {
    const attachmentId = claim.sourceLocator.attachment_id;
    if (!attachmentId) {
      throw new AttachmentAcquisitionError(
        "REFERENCE_ATTACHMENT_ID_MISSING",
        "permanent_failed",
      );
    }
    const initialMaximum = maximumBytesForClaim(claim);
    if (
      claim.sourceSizeBytes !== null &&
      claim.sourceSizeBytes > initialMaximum
    ) {
      throw new AttachmentAcquisitionError(
        "FILE_TOO_LARGE",
        "permanent_failed",
      );
    }

    const sourceMessage = await refetchSourceMessage(this.client, claim);
    const reference = referenceFromMessage(sourceMessage, attachmentId);
    const resolved = await resolveDriveItemReference(this.client, reference);
    const maximumBytes = maximumBytesForDeclaredMime(
      resolved.declaredContentType,
    );
    if (
      resolved.declaredSize !== undefined &&
      resolved.declaredSize > maximumBytes
    ) {
      throw new AttachmentAcquisitionError(
        "FILE_TOO_LARGE",
        "permanent_failed",
      );
    }

    const result = await this.client.getBoundedBytes(
      resolved.contentEndpoint,
      DRIVE_ITEM_CONTENT_ENDPOINT,
      maximumBytes,
    );
    return {
      bytes: result.bytes,
      declaredMimeType:
        resolved.declaredContentType ?? result.contentType ?? null,
    };
  }
}
