import "server-only";

import type { GroupExtractionSummary } from "./types";

const check = (value: boolean): "PASS" | "FAIL" => (value ? "PASS" : "FAIL");

export function formatGroupExtractionSummary(summary: GroupExtractionSummary): string {
  return [
    "GROUP_EXTRACTION_SUMMARY",
    `groups_seen=${summary.groupsSeen}`,
    `groups_processed=${summary.groupsProcessed}`,
    `failed=${summary.failed}`,
    `openai_requests=${summary.openaiRequests}`,
    `candidate_updates=${summary.candidateUpdates}`,
    `new_field_evidence=${summary.newFieldEvidence}`,
    `jobs_completed=${summary.jobsCompleted}`,
    `provider_duration_ms=${summary.providerDurationMs}`,
    `input_tokens=${summary.inputTokens}`,
    `output_tokens=${summary.outputTokens}`,
    `total_tokens=${summary.totalTokens}`,
    `GROUP_A_REQUIRED_CONTACT_CHECK=${check(summary.checks.groupARequiredContact)}`,
    `GROUP_B_REQUIRED_CONTACT_CHECK=${check(summary.checks.groupBRequiredContact)}`,
    `PARTNER_RULE_CHECK=${check(summary.checks.partnerRule)}`,
    `EVIDENCE_REFERENCES_CHECK=${check(summary.checks.evidenceReferences)}`,
    `NO_HALLUCINATED_CONTACT_CHECK=${check(summary.checks.noHallucinatedContact)}`,
    `ELIGIBILITY_RULE_CHECK=${check(summary.checks.eligibilityRule)}`,
    `CUSTOMER_DEFAULT_PROVENANCE_CHECK=${check(summary.checks.customerDefaultProvenance)}`,
    `CAMPAIGN_CONFIG_CHECK=${check(summary.checks.campaignConfig)}`,
  ].join("\n");
}
