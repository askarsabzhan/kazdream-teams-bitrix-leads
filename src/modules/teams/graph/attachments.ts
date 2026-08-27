import "server-only";

import { GraphClient, GraphRequestError } from "./client";
import { parseCollectionPage } from "./pagination";
import type {
  AttachmentTypeCounts,
  DiagnosticMessageRecord,
  GraphAttachmentRecord,
} from "./types";

export const DRIVE_ITEM_CONTENT_ENDPOINT =
  "GET /shares/{encoded-sharing-url}/driveItem/content";
export const DRIVE_ITEM_METADATA_ENDPOINT =
  "GET /shares/{encoded-sharing-url}/driveItem?$select=id,size,file";
const HOSTED_CONTENT_LIST_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents";
const HOSTED_CONTENT_BYTES_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents/{hosted-content-id}/$value";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function mediaKindFromName(
  name: string | undefined,
): "image" | "audio" | undefined {
  if (!name) return undefined;
  const normalized = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg)$/.test(normalized))
    return "image";
  if (/\.(mp3|m4a|wav|ogg|oga|aac|flac|opus|wma|webm)$/.test(normalized))
    return "audio";
  return undefined;
}

export function projectGraphAttachment(
  value: unknown,
): GraphAttachmentRecord | undefined {
  if (!isRecord(value)) return undefined;
  const contentType = nonEmptyString(value.contentType) ?? "unknown";
  const contentUrl = nonEmptyString(value.contentUrl);
  const mediaKindHint = mediaKindFromName(nonEmptyString(value.name));
  return {
    contentType,
    ...(contentUrl ? { contentUrl } : {}),
    ...(mediaKindHint ? { mediaKindHint } : {}),
  };
}

export function hasHostedContentReference(
  bodyContent: string | undefined,
  hostedContents: readonly unknown[],
): boolean {
  return (
    hostedContents.length > 0 ||
    (bodyContent !== undefined && /\/hostedContents\//i.test(bodyContent))
  );
}

export function classifyAttachmentTypes(
  messages: readonly DiagnosticMessageRecord[],
): AttachmentTypeCounts {
  const counts: AttachmentTypeCounts = {
    hostedContent: messages.filter(
      (message) => message.hostedContentReferencePresent,
    ).length,
    reference: 0,
    forwardedMessageReference: 0,
    unknown: 0,
  };

  for (const message of messages) {
    for (const attachment of message.attachments) {
      const contentType = attachment.contentType.toLowerCase();
      if (contentType === "reference") counts.reference += 1;
      else if (contentType === "forwardedmessagereference")
        counts.forwardedMessageReference += 1;
      else counts.unknown += 1;
    }
  }

  return counts;
}

function encodeSharingUrl(url: string): string {
  return `u!${Buffer.from(url, "utf8")
    .toString("base64")
    .replaceAll("=", "")
    .replaceAll("/", "_")
    .replaceAll("+", "-")}`;
}

export async function resolveDriveItemReference(
  client: GraphClient,
  attachment: GraphAttachmentRecord,
): Promise<{
  contentEndpoint: string;
  declaredContentType?: string;
  declaredSize?: number;
}> {
  if (!attachment.contentUrl) {
    throw new GraphRequestError({
      endpoint: DRIVE_ITEM_CONTENT_ENDPOINT,
      httpStatus: null,
      code: "ATTACHMENT_CONTENT_URL_MISSING",
      description: "The reference attachment did not provide a content URL.",
    });
  }

  const sharingToken = encodeSharingUrl(attachment.contentUrl);
  const driveItem = await client.getJson(
    `/shares/${segment(sharingToken)}/driveItem?$select=id,size,file`,
    DRIVE_ITEM_METADATA_ENDPOINT,
  );
  const fileFacet =
    isRecord(driveItem) && isRecord(driveItem.file)
      ? driveItem.file
      : undefined;
  const declaredContentType = nonEmptyString(fileFacet?.mimeType);
  const declaredSize =
    isRecord(driveItem) &&
    typeof driveItem.size === "number" &&
    Number.isSafeInteger(driveItem.size) &&
    driveItem.size >= 0
      ? driveItem.size
      : undefined;

  return {
    contentEndpoint: `/shares/${segment(sharingToken)}/driveItem/content`,
    ...(declaredContentType ? { declaredContentType } : {}),
    ...(declaredSize !== undefined ? { declaredSize } : {}),
  };
}

export function classifyMediaKind(
  contentType: string,
  hint?: "image" | "audio",
): "image" | "audio" | undefined {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  return hint;
}

export async function readDriveItemReference(
  client: GraphClient,
  attachment: GraphAttachmentRecord,
): Promise<{
  contentType: string;
  byteLength: number;
  mediaKind?: "image" | "audio";
}> {
  const resolved = await resolveDriveItemReference(client, attachment);
  const bytes = await client.getByteMetadata(
    resolved.contentEndpoint,
    DRIVE_ITEM_CONTENT_ENDPOINT,
  );
  const contentType = resolved.declaredContentType ?? bytes.contentType;
  const mediaKind = classifyMediaKind(contentType, attachment.mediaKindHint);

  return {
    contentType,
    byteLength: bytes.byteLength,
    ...(mediaKind ? { mediaKind } : {}),
  };
}

export async function readHostedContent(
  client: GraphClient,
  messageResourcePath: string,
): Promise<{
  detectedCount: number;
  endpoint: string;
  contentType: string;
  byteLength: number;
}> {
  const hostedList = parseCollectionPage(
    await client.getJson(
      `${messageResourcePath}/hostedContents`,
      HOSTED_CONTENT_LIST_ENDPOINT,
    ),
    (item) => (isRecord(item) ? nonEmptyString(item.id) : undefined),
    HOSTED_CONTENT_LIST_ENDPOINT,
  );
  const hostedContentId = hostedList.value[0];

  if (!hostedContentId) {
    throw new GraphRequestError({
      endpoint: HOSTED_CONTENT_LIST_ENDPOINT,
      httpStatus: null,
      code: "HOSTED_CONTENT_NOT_RESOLVED",
      description:
        "A hosted-content reference was present but no hosted-content item was returned.",
    });
  }

  const metadata = await client.getByteMetadata(
    `${messageResourcePath}/hostedContents/${segment(hostedContentId)}/$value`,
    HOSTED_CONTENT_BYTES_ENDPOINT,
  );

  return {
    detectedCount: hostedList.value.length,
    endpoint: HOSTED_CONTENT_BYTES_ENDPOINT,
    contentType: metadata.contentType,
    byteLength: metadata.byteLength,
  };
}
