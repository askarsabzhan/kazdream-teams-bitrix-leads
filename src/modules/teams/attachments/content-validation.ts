import "server-only";

import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";

import {
  AttachmentAcquisitionError,
  type AttachmentAcquisitionClaim,
  type ValidatedAttachment,
} from "./types";

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

const GENERIC_DECLARATIONS = new Set([
  "",
  "application/octet-stream",
  "chatmessagehostedcontent",
  "reference",
  "unknown",
]);

function normalizeMimeType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function maximumBytesForDeclaredMime(
  mimeType: string | null | undefined,
): number {
  const normalized = normalizeMimeType(mimeType);
  return normalized.startsWith("image/") ? IMAGE_MAX_BYTES : AUDIO_MAX_BYTES;
}

export function maximumBytesForClaim(
  claim: AttachmentAcquisitionClaim,
): number {
  return claim.attachmentKind === "hosted_content"
    ? IMAGE_MAX_BYTES
    : maximumBytesForDeclaredMime(claim.declaredMimeType);
}

function normalizedDetectedMime(
  detected: string,
  declared: string,
): string {
  if (detected === "video/webm" && declared === "audio/webm") {
    return "audio/webm";
  }
  return detected;
}

function mimeTypesCompatible(detected: string, declared: string): boolean {
  if (GENERIC_DECLARATIONS.has(declared)) return true;
  if (detected === declared) return true;
  if (
    (detected === "audio/wav" && declared === "audio/x-wav") ||
    (detected === "audio/mp4" && declared === "audio/x-m4a")
  ) {
    return true;
  }
  return detected === "audio/webm" && declared === "audio/webm";
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateAttachmentContent(options: {
  bytes: Uint8Array;
  declaredMimeType: string | null;
}): Promise<ValidatedAttachment> {
  const declared = normalizeMimeType(options.declaredMimeType);
  const fileType = await fileTypeFromBuffer(options.bytes);
  if (!fileType) {
    throw new AttachmentAcquisitionError("UNSUPPORTED_MIME", "unsupported");
  }

  const detected = normalizedDetectedMime(
    normalizeMimeType(fileType.mime),
    declared,
  );
  const supportedImage = SUPPORTED_IMAGE_MIME_TYPES.has(detected);
  const supportedAudio = SUPPORTED_AUDIO_MIME_TYPES.has(detected);
  if (!supportedImage && !supportedAudio) {
    throw new AttachmentAcquisitionError("UNSUPPORTED_MIME", "unsupported");
  }
  if (!mimeTypesCompatible(detected, declared)) {
    throw new AttachmentAcquisitionError(
      "MIME_MISMATCH",
      "permanent_failed",
    );
  }

  const maximumBytes = supportedImage ? IMAGE_MAX_BYTES : AUDIO_MAX_BYTES;
  if (options.bytes.byteLength > maximumBytes) {
    throw new AttachmentAcquisitionError(
      "FILE_TOO_LARGE",
      "permanent_failed",
    );
  }

  return {
    bytes: options.bytes,
    byteLength: options.bytes.byteLength,
    mimeType: detected,
    sha256: sha256Hex(options.bytes),
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function deterministicStoragePath(options: {
  teamsMessageId: string;
  attachmentId: string;
  sha256: string;
}): string {
  if (
    !UUID_PATTERN.test(options.teamsMessageId) ||
    !UUID_PATTERN.test(options.attachmentId) ||
    !SHA256_PATTERN.test(options.sha256)
  ) {
    throw new AttachmentAcquisitionError(
      "INVALID_STORAGE_IDENTITY",
      "permanent_failed",
    );
  }
  return `teams/${options.teamsMessageId}/${options.attachmentId}/${options.sha256}`;
}
