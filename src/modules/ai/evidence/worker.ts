import "server-only";

import { EMPTY_AI_PROVIDER_USAGE } from "../providers/usage";

import {
  AttachmentEvidenceError,
  type AttachmentEvidenceClaim,
  type AttachmentEvidenceSummary,
  type AttachmentEvidenceWorkerOptions,
} from "./types";

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function safeError(error: unknown): AttachmentEvidenceError {
  return error instanceof AttachmentEvidenceError
    ? error
    : new AttachmentEvidenceError(
        "UNEXPECTED_AI_EVIDENCE_ERROR",
        "retryable_failed",
      );
}

async function recordFailure(options: {
  worker: AttachmentEvidenceWorkerOptions;
  claim: AttachmentEvidenceClaim;
  error: AttachmentEvidenceError;
  durationMs: number;
}): Promise<void> {
  try {
    await options.worker.repository.recordOutcome({
      claim: options.claim,
      outcome: options.error.outcome,
      errorCode: options.error.code,
      durationMs: options.durationMs,
    });
  } catch {
    // The bounded lease makes the row reclaimable if the failure transition
    // cannot reach PostgreSQL. No source or provider payload is logged here.
  }
}

function addUsage(
  summary: AttachmentEvidenceSummary,
  usage: typeof EMPTY_AI_PROVIDER_USAGE,
): void {
  summary.inputTokens += usage.inputTokens ?? 0;
  summary.outputTokens += usage.outputTokens ?? 0;
  summary.totalTokens += usage.totalTokens ?? 0;
  summary.audioDurationMs += usage.audioDurationMs ?? 0;
}

function assertClaimConfiguration(
  claim: AttachmentEvidenceClaim,
  options: AttachmentEvidenceWorkerOptions,
): void {
  const provider =
    claim.operation === "transcription"
      ? options.transcriptionProvider
      : options.imageProvider;
  if (
    claim.providerName !== provider.providerName ||
    claim.providerModel !== provider.model ||
    claim.promptVersion !== provider.promptVersion
  ) {
    throw new AttachmentEvidenceError(
      "AI_CLAIM_CONFIGURATION_MISMATCH",
      "permanent_failed",
    );
  }
}

export async function processAttachmentEvidenceBatch(
  options: AttachmentEvidenceWorkerOptions,
): Promise<AttachmentEvidenceSummary> {
  if (options.transcriptionProvider.providerName !== options.imageProvider.providerName) {
    throw new AttachmentEvidenceError(
      "AI_PROVIDER_CONFIGURATION_MISMATCH",
      "permanent_failed",
    );
  }

  const claims = await options.repository.claim({
    providerName: options.transcriptionProvider.providerName,
    transcriptionModel: options.transcriptionProvider.model,
    transcriptionVersion: options.transcriptionProvider.promptVersion,
    imageModel: options.imageProvider.model,
    imageVersion: options.imageProvider.promptVersion,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
  });
  const summary: AttachmentEvidenceSummary = {
    audioSeen: 0,
    transcribed: 0,
    imagesSeen: 0,
    ocrCompleted: 0,
    failed: 0,
    openaiRequests: 0,
    providerDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    audioDurationMs: 0,
  };

  for (const claim of claims) {
    if (claim.operation === "transcription") summary.audioSeen += 1;
    else summary.imagesSeen += 1;

    const attemptStartedAt = Date.now();
    let providerDurationMs = 0;
    try {
      assertClaimConfiguration(claim, options);
      const bytes = await options.storage.load(claim);
      const providerStartedAt = Date.now();
      summary.openaiRequests += 1;

      if (claim.operation === "transcription") {
        const result = await options.transcriptionProvider.transcribe({
          bytes,
          mimeType: claim.mimeType,
        });
        providerDurationMs = elapsedMilliseconds(providerStartedAt);
        summary.providerDurationMs += providerDurationMs;
        addUsage(summary, result.usage);
        await options.repository.complete({
          claim,
          evidenceText: result.text,
          documentType: null,
          durationMs: providerDurationMs,
          usage: result.usage,
        });
        summary.transcribed += 1;
      } else {
        const result = await options.imageProvider.extractVisibleText({
          bytes,
          mimeType: claim.mimeType,
        });
        providerDurationMs = elapsedMilliseconds(providerStartedAt);
        summary.providerDurationMs += providerDurationMs;
        addUsage(summary, result.usage);
        await options.repository.complete({
          claim,
          evidenceText: result.visible_text,
          documentType: result.document_type,
          durationMs: providerDurationMs,
          usage: result.usage,
        });
        summary.ocrCompleted += 1;
      }
    } catch (error) {
      const safe = safeError(error);
      const durationMs =
        providerDurationMs > 0
          ? providerDurationMs
          : elapsedMilliseconds(attemptStartedAt);
      await recordFailure({ worker: options, claim, error: safe, durationMs });
      summary.failed += 1;
    }
  }

  return summary;
}
