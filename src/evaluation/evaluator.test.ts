import { describe, expect, it } from "vitest";

import { runSyntheticEvaluation } from "./evaluator";

describe("synthetic delivery evaluation", () => {
  it("measures the frozen deterministic pipeline and replay without production writes", () => {
    const metrics = runSyntheticEvaluation();

    expect(metrics).toMatchObject({
      mode: "DETERMINISTIC_PIPELINE_METRICS",
      messageCount: 60,
      expectedCanonicalLeads: 22,
      actualCanonicalLeads: 22,
      falseMerges: 0,
      falseSplits: 0,
      duplicateCanonicalLeads: 0,
      hallucinatedContactValues: 0,
      eligibilityAccuracy: 1,
      partnerCustomerAccuracy: 1,
      responsibleManagerAccuracy: 1,
      requiredContactFieldAccuracy: 1,
      ambiguousCaseAccuracy: 1,
      precision: 1,
      recall: 1,
      f1: 1,
      edgeCasesPassed: 24,
      edgeCasesTotal: 24,
      aiRequests: 0,
      replay: {
        duplicateMessages: 0,
        duplicateMemberships: 0,
        duplicateGroups: 0,
        duplicateCanonicalLeads: 0,
        duplicateCrmIntents: 0,
      },
    });
  });
});
