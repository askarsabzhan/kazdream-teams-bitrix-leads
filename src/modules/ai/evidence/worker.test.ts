import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EMPTY_AI_PROVIDER_USAGE } from "../providers/usage";

import {
  AttachmentEvidenceError,
  type AttachmentEvidenceClaim,
  type AttachmentEvidenceRepository,
  type AttachmentEvidenceStorage,
} from "./types";
import { processAttachmentEvidenceBatch } from "./worker";

const SHA = "a".repeat(64);

function claim(
  operation: "transcription" | "image_text",
): AttachmentEvidenceClaim {
  return {
    attachmentId:
      operation === "transcription"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    leaseId: "33333333-3333-4333-8333-333333333333",
    operation,
    storagePath: `teams/message/${operation}/${SHA}`,
    mimeType: operation === "transcription" ? "audio/mpeg" : "image/png",
    sizeBytes: 3,
    sourceSha256: SHA,
    providerName: "openai",
    providerModel:
      operation === "transcription"
        ? "gpt-4o-mini-transcribe"
        : "gpt-4o-mini",
    promptVersion:
      operation === "transcription"
        ? "verbatim-transcript-v1"
        : "visible-text-v1",
    processingRevision: 1,
    processingAttempts: 1,
  };
}

function repository(claims: AttachmentEvidenceClaim[]):
  AttachmentEvidenceRepository & {
    complete: ReturnType<typeof vi.fn>;
    recordOutcome: ReturnType<typeof vi.fn>;
  } {
  return {
    claim: vi.fn(async () => claims),
    complete: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
  };
}

function storage(): AttachmentEvidenceStorage & {
  load: ReturnType<typeof vi.fn>;
} {
  return { load: vi.fn(async () => new Uint8Array([1, 2, 3])) };
}

function providers() {
  return {
    transcriptionProvider: {
      providerName: "openai",
      model: "gpt-4o-mini-transcribe",
      promptVersion: "verbatim-transcript-v1",
      transcribe: vi.fn(async () => ({
        text: "Сәлем, hello — без изменений.",
        usage: EMPTY_AI_PROVIDER_USAGE,
      })),
    },
    imageProvider: {
      providerName: "openai",
      model: "gpt-4o-mini",
      promptVersion: "visible-text-v1",
      extractVisibleText: vi.fn(async () => ({
        document_type: "business_card" as const,
        visible_text: "VISIBLE_TEXT_FIXTURE",
        usage: EMPTY_AI_PROVIDER_USAGE,
      })),
    },
  };
}

async function run(options: {
  repository: AttachmentEvidenceRepository;
  storage?: AttachmentEvidenceStorage;
  providerOverrides?: Partial<ReturnType<typeof providers>>;
}) {
  const baseProviders = providers();
  return processAttachmentEvidenceBatch({
    repository: options.repository,
    storage: options.storage ?? storage(),
    ...baseProviders,
    ...options.providerOverrides,
    limit: 5,
    leaseSeconds: 300,
  });
}

describe("attachment evidence worker", () => {
  it("stores transcript and image evidence without changing returned text", async () => {
    const audio = claim("transcription");
    const image = claim("image_text");
    const repo = repository([audio, image]);

    const summary = await run({ repository: repo });

    expect(summary).toMatchObject({
      audioSeen: 1,
      transcribed: 1,
      imagesSeen: 1,
      ocrCompleted: 1,
      failed: 0,
      openaiRequests: 2,
    });
    expect(repo.complete).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        claim: audio,
        evidenceText: "Сәлем, hello — без изменений.",
        documentType: null,
      }),
    );
    expect(repo.complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        claim: image,
        evidenceText: "VISIBLE_TEXT_FIXTURE",
        documentType: "business_card",
      }),
    );
  });

  it("makes no provider request when the repository reuses completed evidence", async () => {
    const repo = repository([]);
    const configuredProviders = providers();

    const summary = await processAttachmentEvidenceBatch({
      repository: repo,
      storage: storage(),
      ...configuredProviders,
      limit: 5,
      leaseSeconds: 300,
    });

    expect(summary.openaiRequests).toBe(0);
    expect(configuredProviders.transcriptionProvider.transcribe).not.toHaveBeenCalled();
    expect(configuredProviders.imageProvider.extractVisibleText).not.toHaveBeenCalled();
  });

  it("records only a safe provider failure code", async () => {
    const audio = claim("transcription");
    const repo = repository([audio]);
    const transcriptionProvider = providers().transcriptionProvider;
    transcriptionProvider.transcribe.mockRejectedValueOnce(
      new AttachmentEvidenceError("OPENAI_RATE_LIMITED", "retryable_failed"),
    );

    const summary = await run({
      repository: repo,
      providerOverrides: { transcriptionProvider },
    });

    expect(summary).toMatchObject({ failed: 1, openaiRequests: 1 });
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "retryable_failed",
        errorCode: "OPENAI_RATE_LIMITED",
      }),
    );
  });

  it("prevents the provider call when Storage integrity fails", async () => {
    const audio = claim("transcription");
    const repo = repository([audio]);
    const configuredProviders = providers();
    const brokenStorage: AttachmentEvidenceStorage = {
      load: vi.fn(async () => {
        throw new AttachmentEvidenceError(
          "STORAGE_HASH_MISMATCH",
          "permanent_failed",
        );
      }),
    };

    const summary = await processAttachmentEvidenceBatch({
      repository: repo,
      storage: brokenStorage,
      ...configuredProviders,
      limit: 5,
      leaseSeconds: 300,
    });

    expect(summary).toMatchObject({ failed: 1, openaiRequests: 0 });
    expect(configuredProviders.transcriptionProvider.transcribe).not.toHaveBeenCalled();
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "permanent_failed",
        errorCode: "STORAGE_HASH_MISMATCH",
      }),
    );
  });

  it("rejects a mismatched durable claim before reading source bytes", async () => {
    const audio = {
      ...claim("transcription"),
      providerModel: "unexpected-model",
    };
    const repo = repository([audio]);
    const configuredProviders = providers();
    const sourceStorage = storage();

    const summary = await processAttachmentEvidenceBatch({
      repository: repo,
      storage: sourceStorage,
      ...configuredProviders,
      limit: 5,
      leaseSeconds: 300,
    });

    expect(summary).toMatchObject({ failed: 1, openaiRequests: 0 });
    expect(sourceStorage.load).not.toHaveBeenCalled();
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "permanent_failed",
        errorCode: "AI_CLAIM_CONFIGURATION_MISMATCH",
      }),
    );
  });
});
