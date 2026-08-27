import "server-only";

import {
  deterministicStoragePath,
  validateAttachmentContent,
} from "./content-validation";
import {
  AttachmentAcquisitionError,
  type AttachmentAcquisitionClaim,
  type AttachmentAcquisitionFailureState,
  type AttachmentAcquisitionRepository,
  type AttachmentAcquisitionSummary,
  type AttachmentByteSource,
  type AttachmentObjectStorage,
} from "./types";

function safeError(error: unknown): AttachmentAcquisitionError {
  return error instanceof AttachmentAcquisitionError
    ? error
    : new AttachmentAcquisitionError(
        "UNEXPECTED_ACQUISITION_ERROR",
        "retryable_failed",
      );
}

async function recordFailure(options: {
  repository: AttachmentAcquisitionRepository;
  claim: AttachmentAcquisitionClaim;
  outcome: AttachmentAcquisitionFailureState;
  errorCode: string;
}): Promise<void> {
  try {
    await options.repository.recordOutcome(options);
  } catch {
    // If PostgreSQL is temporarily unavailable, the bounded lease makes the
    // downloading row reclaimable without discarding a successfully uploaded
    // deterministic object.
  }
}

export async function acquireAttachmentBatch(options: {
  repository: AttachmentAcquisitionRepository;
  byteSource: AttachmentByteSource;
  storage: AttachmentObjectStorage;
  limit: number;
  leaseSeconds: number;
}): Promise<AttachmentAcquisitionSummary> {
  const claims = await options.repository.claim({
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
  });
  const summary: AttachmentAcquisitionSummary = {
    attachmentsSeen: claims.length,
    claimed: claims.length,
    stored: 0,
    unsupported: 0,
    failed: 0,
    bytesStored: 0,
    objectsCreated: 0,
    objectsReused: 0,
  };

  for (const claim of claims) {
    try {
      const downloaded = await options.byteSource.download(claim);
      const validated = await validateAttachmentContent(downloaded);
      const storagePath = deterministicStoragePath({
        teamsMessageId: claim.teamsMessageId,
        attachmentId: claim.attachmentId,
        sha256: validated.sha256,
      });
      const storageResult = await options.storage.store({
        path: storagePath,
        bytes: validated.bytes,
        contentType: validated.mimeType,
        sha256: validated.sha256,
      });
      await options.repository.complete({
        claim,
        storagePath,
        validated,
      });

      summary.stored += 1;
      summary.bytesStored += validated.byteLength;
      if (storageResult.alreadyExisted) summary.objectsReused += 1;
      else summary.objectsCreated += 1;
    } catch (error) {
      const safe = safeError(error);
      await recordFailure({
        repository: options.repository,
        claim,
        outcome: safe.outcome,
        errorCode: safe.code,
      });
      if (safe.outcome === "unsupported") summary.unsupported += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}
