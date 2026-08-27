import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TEAMS_ATTACHMENT_BUCKET } from "../constants";

import { sha256Hex } from "./content-validation";
import {
  AttachmentAcquisitionError,
  type AttachmentObjectStorage,
} from "./types";

type StorageBucketClient = ReturnType<SupabaseClient["storage"]["from"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    error.status === 409 ||
    error.statusCode === "409" ||
    error.code === "Duplicate" ||
    error.code === "409"
  );
}

export class SupabaseAttachmentObjectStorage
  implements AttachmentObjectStorage
{
  constructor(private readonly bucket: StorageBucketClient) {}

  async store(options: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<{ alreadyExisted: boolean }> {
    const upload = await this.bucket.upload(options.path, options.bytes, {
      cacheControl: "31536000",
      contentType: options.contentType,
      upsert: false,
    });
    if (!upload.error) return { alreadyExisted: false };
    if (!isAlreadyExistsError(upload.error)) {
      throw new AttachmentAcquisitionError(
        "STORAGE_UPLOAD_FAILED",
        "retryable_failed",
      );
    }

    await this.verifyExistingObject(options);
    return { alreadyExisted: true };
  }

  private async verifyExistingObject(options: {
    path: string;
    bytes: Uint8Array;
    sha256: string;
  }): Promise<void> {
    const info = await this.bucket.info(options.path);
    if (
      info.error ||
      typeof info.data.size !== "number" ||
      info.data.size !== options.bytes.byteLength
    ) {
      throw new AttachmentAcquisitionError(
        "STORAGE_OBJECT_CONFLICT",
        "permanent_failed",
      );
    }

    const download = await this.bucket.download(options.path);
    if (download.error || download.data.size !== options.bytes.byteLength) {
      throw new AttachmentAcquisitionError(
        "STORAGE_OBJECT_VERIFY_FAILED",
        "retryable_failed",
      );
    }
    const existingBytes = new Uint8Array(await download.data.arrayBuffer());
    if (sha256Hex(existingBytes) !== options.sha256) {
      throw new AttachmentAcquisitionError(
        "STORAGE_OBJECT_CONFLICT",
        "permanent_failed",
      );
    }
  }
}

export function createSupabaseAttachmentObjectStorage(
  client: SupabaseClient,
): SupabaseAttachmentObjectStorage {
  return new SupabaseAttachmentObjectStorage(
    client.storage.from(TEAMS_ATTACHMENT_BUCKET),
  );
}
