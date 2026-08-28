import "server-only";

import {
  candidateIdentityKeys,
  candidateSecondaryKeys,
  composeCanonicalLead,
} from "./composition";
import {
  CanonicalizationError,
  type CanonicalizationRepository,
  type CanonicalizationSummary,
  type CanonicalSummaryClaim,
  type CanonicalSummaryProvider,
} from "./types";

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function recordSummaryFailure(options: {
  repository: CanonicalizationRepository;
  claim: CanonicalSummaryClaim;
  error: CanonicalizationError;
  durationMs: number;
}): Promise<void> {
  try {
    await options.repository.recordSummaryFailure({
      claim: options.claim,
      outcome: options.error.outcome,
      errorCode: options.error.code,
      durationMs: options.durationMs,
    });
  } catch {
    // A fenced lease remains reclaimable. Never log canonical or evidence data.
  }
}

export async function processCanonicalization(options: {
  repository: CanonicalizationRepository;
  summaryProvider: CanonicalSummaryProvider;
  summaryLimit: number;
  summaryLeaseSeconds: number;
}): Promise<CanonicalizationSummary> {
  const groups = await options.repository.loadEligibleGroups();
  const summary: CanonicalizationSummary = {
    groupsSeen: groups.length,
    canonicalLeadsCreated: 0,
    canonicalLeadsUpdated: 0,
    groupsLinked: 0,
    identityConflicts: 0,
    summaryRequests: 0,
    summariesCompleted: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  for (const group of groups) {
    const secondary = candidateSecondaryKeys(group);
    const resolution = await options.repository.resolveGroup({
      group,
      identityKeys: candidateIdentityKeys(group),
      nameKey: secondary.nameKey,
      companyKey: secondary.companyKey,
    });
    if (resolution.state === "identity_conflict" || resolution.leadId === null) {
      summary.identityConflicts += 1;
      continue;
    }
    if (resolution.leadCreated) {
      summary.canonicalLeadsCreated += 1;
    }
    if (resolution.groupLinked) summary.groupsLinked += 1;

    const refreshedGroups = await options.repository.loadEligibleGroups();
    const linkedGroups = refreshedGroups.filter(
      (candidateGroup) => candidateGroup.leadId === resolution.leadId,
    );
    const completion = await options.repository.completeComposition(
      resolution.leadId,
      composeCanonicalLead(linkedGroups),
    );
    if (completion.updated && !resolution.leadCreated) {
      summary.canonicalLeadsUpdated += 1;
    }
  }

  const claims = await options.repository.claimSummaries({
    provider: options.summaryProvider.providerName,
    model: options.summaryProvider.model,
    promptVersion: options.summaryProvider.promptVersion,
    limit: options.summaryLimit,
    leaseSeconds: options.summaryLeaseSeconds,
  });
  for (const claim of claims) {
    const startedAt = Date.now();
    try {
      if (
        claim.provider !== options.summaryProvider.providerName ||
        claim.model !== options.summaryProvider.model ||
        claim.promptVersion !== options.summaryProvider.promptVersion
      ) {
        throw new CanonicalizationError(
          "SUMMARY_CONFIGURATION_MISMATCH",
          "permanent_failed",
        );
      }
      summary.summaryRequests += 1;
      const result = await options.summaryProvider.summarize(claim);
      await options.repository.completeSummary({
        claim,
        summaryRu: result.summaryRu,
        durationMs: elapsed(startedAt),
        usage: result.usage,
      });
      summary.summariesCompleted += 1;
      summary.inputTokens += result.usage.inputTokens ?? 0;
      summary.outputTokens += result.usage.outputTokens ?? 0;
      summary.totalTokens += result.usage.totalTokens ?? 0;
    } catch (error) {
      const safeError =
        error instanceof CanonicalizationError
          ? error
          : new CanonicalizationError("CANONICAL_SUMMARY_ERROR");
      await recordSummaryFailure({
        repository: options.repository,
        claim,
        error: safeError,
        durationMs: elapsed(startedAt),
      });
      summary.failures += 1;
    }
  }
  return summary;
}
