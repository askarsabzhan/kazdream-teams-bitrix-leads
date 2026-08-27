import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TEAMS_ATTACHMENT_BUCKET } from "../../teams/constants";
import { validateAttachmentContent } from "../../teams/attachments/content-validation";

import {
  AttachmentEvidenceError,
  type AttachmentEvidenceClaim,
  type AttachmentEvidenceStorage,
} from "./types";

type StorageBucketClient = ReturnType<SupabaseClient["storage"]["from"]>;

function storageStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }
  if ("statusCode" in error) {
    const parsed = Number(error.statusCode);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function storageReadError(error: unknown): AttachmentEvidenceError {
  const status = storageStatus(error);
  if (status === 404) {
    return new AttachmentEvidenceError(
      "STORAGE_OBJECT_NOT_FOUND",
      "permanent_failed",
    );
  }
  if (status === 400 || status === 403) {
    return new AttachmentEvidenceError(
      "STORAGE_OBJECT_UNAVAILABLE",
      "permanent_failed",
    );
  }
  return new AttachmentEvidenceError(
    "STORAGE_READ_FAILED",
    "retryable_failed",
  );
}

export class SupabaseAttachmentEvidenceStorage
  implements AttachmentEvidenceStorage
{
  constructor(private readonly bucket: StorageBucketClient) {}

  async load(claim: AttachmentEvidenceClaim): Promise<Uint8Array> {
    const info = await this.bucket.info(claim.storagePath);
    if (info.error) throw storageReadError(info.error);
    if (typeof info.data.size !== "number" || info.data.size !== claim.sizeBytes) {
      throw new AttachmentEvidenceError(
        "STORAGE_SIZE_MISMATCH",
        "permanent_failed",
      );
    }

    const download = await this.bucket.download(claim.storagePath);
    if (download.error) throw storageReadError(download.error);
    if (download.data.size !== claim.sizeBytes) {
      throw new AttachmentEvidenceError(
        "STORAGE_SIZE_MISMATCH",
        "permanent_failed",
      );
    }

    const bytes = new Uint8Array(await download.data.arrayBuffer());
    let validated;
    try {
      validated = await validateAttachmentContent({
        bytes,
        declaredMimeType: claim.mimeType,
      });
    } catch {
      throw new AttachmentEvidenceError(
        "STORAGE_MIME_MISMATCH",
        "permanent_failed",
      );
    }
    if (validated.byteLength !== claim.sizeBytes) {
      throw new AttachmentEvidenceError(
        "STORAGE_SIZE_MISMATCH",
        "permanent_failed",
      );
    }
    if (validated.sha256 !== claim.sourceSha256) {
      throw new AttachmentEvidenceError(
        "STORAGE_HASH_MISMATCH",
        "permanent_failed",
      );
    }
    if (validated.mimeType !== claim.mimeType) {
      throw new AttachmentEvidenceError(
        "STORAGE_MIME_MISMATCH",
        "permanent_failed",
      );
    }
    return bytes;
  }
}

export function createSupabaseAttachmentEvidenceStorage(
  client: SupabaseClient,
): SupabaseAttachmentEvidenceStorage {
  return new SupabaseAttachmentEvidenceStorage(
    client.storage.from(TEAMS_ATTACHMENT_BUCKET),
  );
}
