import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatGroupExtractionSummary } from "./format";

describe("group extraction safe summary", () => {
  it("contains only aggregate metrics and named checks", () => {
    const output = formatGroupExtractionSummary({
      groupsSeen: 2,
      groupsProcessed: 2,
      failed: 0,
      openaiRequests: 2,
      candidateUpdates: 2,
      newFieldEvidence: 12,
      jobsCompleted: 2,
      providerDurationMs: 500,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      checks: {
        groupARequiredContact: true,
        groupBRequiredContact: true,
        partnerRule: true,
        evidenceReferences: true,
        noHallucinatedContact: true,
        eligibilityRule: true,
        customerDefaultProvenance: true,
        campaignConfig: true,
      },
    });

    expect(output).toContain("openai_requests=2");
    expect(output).toContain("NO_HALLUCINATED_CONTACT_CHECK=PASS");
    expect(output).toContain("ELIGIBILITY_RULE_CHECK=PASS");
    expect(output).toContain("CUSTOMER_DEFAULT_PROVENANCE_CHECK=PASS");
    expect(output).toContain("CAMPAIGN_CONFIG_CHECK=PASS");
    expect(output).not.toMatch(/@|\+\d|Alice|candidate_payload|evidence_text/u);
  });
});
