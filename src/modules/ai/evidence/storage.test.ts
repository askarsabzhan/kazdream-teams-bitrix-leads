import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sha256Hex } from "../../teams/attachments/content-validation";

import { SupabaseAttachmentEvidenceStorage } from "./storage";
import type { AttachmentEvidenceClaim } from "./types";

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

function claim(sha256 = sha256Hex(PNG_BYTES)): AttachmentEvidenceClaim {
  return {
    attachmentId: "11111111-1111-4111-8111-111111111111",
    leaseId: "22222222-2222-4222-8222-222222222222",
    operation: "image_text",
    storagePath: "teams/message/attachment/hash",
    mimeType: "image/png",
    sizeBytes: PNG_BYTES.byteLength,
    sourceSha256: sha256,
    providerName: "openai",
    providerModel: "gpt-4o-mini",
    promptVersion: "visible-text-v1",
    processingRevision: 1,
    processingAttempts: 1,
  };
}

function bucket() {
  return {
    info: vi.fn(async () => ({
      data: { size: PNG_BYTES.byteLength },
      error: null,
    })),
    download: vi.fn(async () => ({
      data: new Blob([PNG_BYTES], { type: "image/png" }),
      error: null,
    })),
  };
}

describe("attachment evidence Storage loader", () => {
  it("returns only bytes that match size, MIME, and SHA-256", async () => {
    const loader = new SupabaseAttachmentEvidenceStorage(bucket() as never);
    await expect(loader.load(claim())).resolves.toEqual(PNG_BYTES);
  });

  it("rejects a database SHA mismatch", async () => {
    const loader = new SupabaseAttachmentEvidenceStorage(bucket() as never);
    await expect(loader.load(claim("b".repeat(64)))).rejects.toMatchObject({
      code: "STORAGE_HASH_MISMATCH",
      outcome: "permanent_failed",
    });
  });
});
