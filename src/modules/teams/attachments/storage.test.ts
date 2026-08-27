import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sha256Hex } from "./content-validation";
import { SupabaseAttachmentObjectStorage } from "./storage";

describe("private attachment object storage", () => {
  it("verifies bytes before accepting an existing deterministic object", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const bucket = {
      upload: vi.fn(async () => ({
        data: null,
        error: { status: 409, code: "Duplicate" },
      })),
      info: vi.fn(async () => ({ data: { size: 3 }, error: null })),
      download: vi.fn(async () => ({
        data: new Blob([bytes]),
        error: null,
      })),
    };
    const storage = new SupabaseAttachmentObjectStorage(
      bucket as never,
    );

    await expect(
      storage.store({
        path: "teams/message/attachment/hash",
        bytes,
        contentType: "image/png",
        sha256: sha256Hex(bytes),
      }),
    ).resolves.toEqual({ alreadyExisted: true });
    expect(bucket.upload).toHaveBeenCalledWith(
      "teams/message/attachment/hash",
      bytes,
      expect.objectContaining({ upsert: false, contentType: "image/png" }),
    );
  });

  it("rejects an existing object whose bytes do not match the expected hash", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const bucket = {
      upload: vi.fn(async () => ({
        data: null,
        error: { status: 409 },
      })),
      info: vi.fn(async () => ({ data: { size: 3 }, error: null })),
      download: vi.fn(async () => ({
        data: new Blob([new Uint8Array([3, 2, 1])]),
        error: null,
      })),
    };
    const storage = new SupabaseAttachmentObjectStorage(
      bucket as never,
    );

    await expect(
      storage.store({
        path: "teams/message/attachment/hash",
        bytes,
        contentType: "image/png",
        sha256: sha256Hex(bytes),
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_OBJECT_CONFLICT",
      outcome: "permanent_failed",
    });
  });
});
