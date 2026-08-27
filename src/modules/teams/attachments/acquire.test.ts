import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { acquireAttachmentBatch } from "./acquire";
import {
  AttachmentAcquisitionError,
  type AttachmentAcquisitionClaim,
  type AttachmentAcquisitionRepository,
  type AttachmentByteSource,
  type AttachmentObjectStorage,
} from "./types";

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

function claim(
  overrides: Partial<AttachmentAcquisitionClaim> = {},
): AttachmentAcquisitionClaim {
  return {
    attachmentId: "22222222-2222-4222-8222-222222222222",
    teamsMessageId: "11111111-1111-4111-8111-111111111111",
    leaseId: "33333333-3333-4333-8333-333333333333",
    tenantId: "tenant-test",
    teamId: "team-test",
    channelId: "channel-test",
    externalMessageId: "message-test",
    rootExternalMessageId: null,
    attachmentKind: "hosted_content",
    sourceLocator: { hosted_content_id: "hosted-test" },
    declaredMimeType: null,
    sourceSizeBytes: null,
    fetchAttempts: 1,
    ...overrides,
  };
}

function repository(
  claims: AttachmentAcquisitionClaim[][],
): AttachmentAcquisitionRepository & {
  complete: ReturnType<typeof vi.fn>;
  recordOutcome: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn(async () => claims.shift() ?? []),
    complete: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
  };
}

function source(): AttachmentByteSource & {
  download: ReturnType<typeof vi.fn>;
} {
  return {
    download: vi.fn(async () => ({
      bytes: PNG_BYTES,
      declaredMimeType: "image/png",
    })),
  };
}

function storage(): AttachmentObjectStorage & {
  store: ReturnType<typeof vi.fn>;
} {
  return {
    store: vi.fn(async () => ({ alreadyExisted: false })),
  };
}

async function run(options: {
  repository: AttachmentAcquisitionRepository;
  byteSource: AttachmentByteSource;
  storage: AttachmentObjectStorage;
}) {
  return acquireAttachmentBatch({
    ...options,
    limit: 5,
    leaseSeconds: 300,
  });
}

describe("attachment acquisition orchestration", () => {
  it("stores a supported hosted-content fixture", async () => {
    const claimed = claim();
    const repo = repository([[claimed]]);

    const summary = await run({
      repository: repo,
      byteSource: source(),
      storage: storage(),
    });

    expect(summary).toMatchObject({
      claimed: 1,
      stored: 1,
      unsupported: 0,
      failed: 0,
      objectsCreated: 1,
    });
    expect(repo.complete).toHaveBeenCalledOnce();
  });

  it("records unsupported MIME as a terminal non-failure outcome", async () => {
    const repo = repository([[claim()]]);
    const byteSource = source();
    byteSource.download.mockResolvedValue({
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF"),
      declaredMimeType: "application/pdf",
    });

    const summary = await run({
      repository: repo,
      byteSource,
      storage: storage(),
    });

    expect(summary).toMatchObject({ stored: 0, unsupported: 1, failed: 0 });
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unsupported",
        errorCode: "UNSUPPORTED_MIME",
      }),
    );
  });

  it("records a declared/detected MIME mismatch as permanent failure", async () => {
    const repo = repository([[claim()]]);
    const byteSource = source();
    byteSource.download.mockResolvedValue({
      bytes: PNG_BYTES,
      declaredMimeType: "audio/mpeg",
    });

    const summary = await run({
      repository: repo,
      byteSource,
      storage: storage(),
    });

    expect(summary.failed).toBe(1);
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "permanent_failed",
        errorCode: "MIME_MISMATCH",
      }),
    );
  });

  it("retries after a temporary Graph failure", async () => {
    const first = claim();
    const second = claim({
      leaseId: "44444444-4444-4444-8444-444444444444",
      fetchAttempts: 2,
    });
    const repo = repository([[first], [second]]);
    const byteSource = source();
    byteSource.download
      .mockRejectedValueOnce(
        new AttachmentAcquisitionError(
          "GRAPH_TEMPORARY_FAILURE",
          "retryable_failed",
        ),
      )
      .mockResolvedValueOnce({
        bytes: PNG_BYTES,
        declaredMimeType: "image/png",
      });
    const objectStorage = storage();

    expect(
      await run({ repository: repo, byteSource, storage: objectStorage }),
    ).toMatchObject({ failed: 1, stored: 0 });
    expect(
      await run({ repository: repo, byteSource, storage: objectStorage }),
    ).toMatchObject({ failed: 0, stored: 1 });
  });

  it("retries after a temporary Storage failure", async () => {
    const repo = repository([
      [claim()],
      [
        claim({
          leaseId: "44444444-4444-4444-8444-444444444444",
          fetchAttempts: 2,
        }),
      ],
    ]);
    const objectStorage = storage();
    objectStorage.store
      .mockRejectedValueOnce(
        new AttachmentAcquisitionError(
          "STORAGE_UPLOAD_FAILED",
          "retryable_failed",
        ),
      )
      .mockResolvedValueOnce({ alreadyExisted: false });

    expect(
      await run({ repository: repo, byteSource: source(), storage: objectStorage }),
    ).toMatchObject({ failed: 1, stored: 0 });
    expect(
      await run({ repository: repo, byteSource: source(), storage: objectStorage }),
    ).toMatchObject({ failed: 0, stored: 1 });
  });

  it("reconciles an existing deterministic object after DB finalize failure", async () => {
    const repo = repository([
      [claim()],
      [
        claim({
          leaseId: "44444444-4444-4444-8444-444444444444",
          fetchAttempts: 2,
        }),
      ],
    ]);
    repo.complete
      .mockRejectedValueOnce(new Error("synthetic finalize failure"))
      .mockResolvedValueOnce(undefined);
    const objectStorage = storage();
    objectStorage.store
      .mockResolvedValueOnce({ alreadyExisted: false })
      .mockResolvedValueOnce({ alreadyExisted: true });

    expect(
      await run({ repository: repo, byteSource: source(), storage: objectStorage }),
    ).toMatchObject({ failed: 1, stored: 0 });
    expect(
      await run({ repository: repo, byteSource: source(), storage: objectStorage }),
    ).toMatchObject({
      failed: 0,
      stored: 1,
      objectsCreated: 0,
      objectsReused: 1,
    });
  });
});
