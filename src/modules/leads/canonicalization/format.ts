import "server-only";

import type { CanonicalizationSummary } from "./types";

export function formatCanonicalizationSummary(summary: CanonicalizationSummary): string {
  return [
    "CANONICALIZATION_SUMMARY",
    `groups_seen=${summary.groupsSeen}`,
    `canonical_leads_created=${summary.canonicalLeadsCreated}`,
    `canonical_leads_updated=${summary.canonicalLeadsUpdated}`,
    `groups_linked=${summary.groupsLinked}`,
    `identity_conflicts=${summary.identityConflicts}`,
    `summary_requests=${summary.summaryRequests}`,
    `summaries_completed=${summary.summariesCompleted}`,
    `failures=${summary.failures}`,
    `input_tokens=${summary.inputTokens}`,
    `output_tokens=${summary.outputTokens}`,
    `total_tokens=${summary.totalTokens}`,
  ].join("\n");
}
