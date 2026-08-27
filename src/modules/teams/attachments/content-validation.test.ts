import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deterministicStoragePath,
  sha256Hex,
  validateAttachmentContent,
} from "./content-validation";

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

describe("attachment content validation", () => {
  it("detects supported PNG bytes and calculates deterministic SHA-256", async () => {
    const first = await validateAttachmentContent({
      bytes: PNG_BYTES,
      declaredMimeType: "image/png",
    });
    const second = await validateAttachmentContent({
      bytes: PNG_BYTES,
      declaredMimeType: "application/octet-stream",
    });

    expect(first.mimeType).toBe("image/png");
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second.sha256).toBe(first.sha256);
    expect(sha256Hex(PNG_BYTES)).toBe(first.sha256);
  });

  it("marks an unsupported binary type without treating it as retryable", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF");

    await expect(
      validateAttachmentContent({
        bytes: pdf,
        declaredMimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MIME",
      outcome: "unsupported",
    });
  });

  it("rejects a material declared/detected MIME mismatch", async () => {
    await expect(
      validateAttachmentContent({
        bytes: PNG_BYTES,
        declaredMimeType: "audio/mpeg",
      }),
    ).rejects.toMatchObject({
      code: "MIME_MISMATCH",
      outcome: "permanent_failed",
    });
  });

  it("builds a deterministic path from internal UUIDs and hash only", () => {
    const sha256 = sha256Hex(PNG_BYTES);
    const path = deterministicStoragePath({
      teamsMessageId: "11111111-1111-4111-8111-111111111111",
      attachmentId: "22222222-2222-4222-8222-222222222222",
      sha256,
    });

    expect(path).toBe(
      `teams/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${sha256}`,
    );
    expect(path).not.toMatch(/@|\.(png|mp3)|visitor|manager/i);
  });
});
