import "server-only";

import { EMPTY_AI_PROVIDER_USAGE } from "../../ai/providers/usage";

import {
  evaluateGroupExtractionChecks,
  validateGroupExtraction,
} from "./validation";
import {
  GroupExtractionError,
  type GroupExtractionClaim,
  type GroupExtractionSummary,
  type GroupExtractionWorkerOptions,
} from "./types";

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function safeError(error: unknown): GroupExtractionError {
  return error instanceof GroupExtractionError
    ? error
    : new GroupExtractionError("UNEXPECTED_GROUP_EXTRACTION_ERROR", "retryable_failed");
}

function addUsage(
  summary: GroupExtractionSummary,
  usage: typeof EMPTY_AI_PROVIDER_USAGE,
): void {
  summary.inputTokens += usage.inputTokens ?? 0;
  summary.outputTokens += usage.outputTokens ?? 0;
  summary.totalTokens += usage.totalTokens ?? 0;
}

function assertClaimConfiguration(
  claim: GroupExtractionClaim,
  options: GroupExtractionWorkerOptions,
): void {
  const provider = options.provider;
  if (
    claim.providerName !== provider.providerName ||
    claim.providerModel !== provider.model ||
    claim.promptVersion !== provider.promptVersion ||
    claim.schemaVersion !== provider.schemaVersion
  ) {
    throw new GroupExtractionError(
      "GROUP_EXTRACTION_CONFIGURATION_MISMATCH",
      "permanent_failed",
    );
  }
}

async function recordFailure(options: {
  worker: GroupExtractionWorkerOptions;
  claim: GroupExtractionClaim;
  error: GroupExtractionError;
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
    // The durable lease makes the group reclaimable. Never log candidate/source data.
  }
}

export async function processGroupExtractionBatch(
  options: GroupExtractionWorkerOptions,
): Promise<GroupExtractionSummary> {
  const claims = await options.repository.claim({
    providerName: options.provider.providerName,
    providerModel: options.provider.model,
    promptVersion: options.provider.promptVersion,
    schemaVersion: options.provider.schemaVersion,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
  });
  const summary: GroupExtractionSummary = {
    groupsSeen: claims.length,
    groupsProcessed: 0,
    failed: 0,
    openaiRequests: 0,
    candidateUpdates: 0,
    newFieldEvidence: 0,
    jobsCompleted: 0,
    providerDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    checks: {
      groupARequiredContact: false,
      groupBRequiredContact: false,
      partnerRule: false,
      evidenceReferences: false,
      noHallucinatedContact: false,
      eligibilityRule: false,
      customerDefaultProvenance: false,
      campaignConfig: false,
    },
  };

  for (const claim of claims) {
    const attemptStartedAt = Date.now();
    let providerDurationMs = 0;
    try {
      assertClaimConfiguration(claim, options);
      const providerStartedAt = Date.now();
      summary.openaiRequests += 1;
      const result = await options.provider.extract(claim.evidenceItems);
      providerDurationMs = elapsedMilliseconds(providerStartedAt);
      summary.providerDurationMs += providerDurationMs;
      addUsage(summary, result.usage);
      const extraction = validateGroupExtraction(result.output, claim.evidenceItems);
      const evidenceCount = await options.repository.complete({
        claim,
        extraction,
        durationMs: providerDurationMs,
        usage: result.usage,
      });
      summary.groupsProcessed += 1;
      summary.candidateUpdates += 1;
      summary.newFieldEvidence += evidenceCount;
      summary.jobsCompleted += 1;
    } catch (error) {
      const safe = safeError(error);
      await recordFailure({
        worker: options,
        claim,
        error: safe,
        durationMs:
          providerDurationMs > 0
            ? providerDurationMs
            : elapsedMilliseconds(attemptStartedAt),
      });
      summary.failed += 1;
    }
  }

  const snapshots = await options.repository.loadVerificationSnapshots();
  summary.checks = evaluateGroupExtractionChecks(snapshots);
  return summary;
}
