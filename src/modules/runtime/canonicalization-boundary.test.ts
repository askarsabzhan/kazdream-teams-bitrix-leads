import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  CanonicalizationRepository,
  CanonicalSummaryProvider,
  EligibleCanonicalGroup,
} from "../leads/canonicalization/types";
import { processCanonicalization } from "../leads/canonicalization/worker";
import type { GroupCandidatePayload } from "../leads/extraction/types";

const candidate: GroupCandidatePayload = {
  person: {
    fullName: { value: "Synthetic Person", evidenceIds: ["e:1"], status: "supported" },
    company: { value: null, evidenceIds: [], status: "uncertain" },
    jobTitle: { value: null, evidenceIds: [], status: "uncertain" },
  },
  phones: [{ value: "+495000000001", evidenceIds: ["e:1"] }],
  emails: [],
  relationshipIndicators: [],
  productInterests: [],
  region: { value: null, evidenceIds: [], status: "uncertain" },
  priority: { value: null, evidenceIds: [], status: "uncertain" },
  facts: [],
  leadType: { value: "Customer", evidenceIds: [], reason: "CUSTOMER_DEFAULT" },
  campaign: {
    exhibition: "Hannover Messe 2026",
    exhibitionBitrixId: 63,
    source: "EXHIBITION",
  },
  eligibility: { state: "eligible", reasonCode: null },
};

const group: EligibleCanonicalGroup = {
  groupId: "71000000-0000-4000-8000-000000000001",
  leadId: "73000000-0000-4000-8000-000000000001",
  candidateSourceFingerprint: "a".repeat(64),
  candidate,
  contributors: [
    {
      teamsMessageId: "72000000-0000-4000-8000-000000000001",
      authorTeamsUserId: "synthetic-manager",
      sourceCreatedAt: "2026-08-29T00:00:00Z",
    },
  ],
};

describe("canonicalization production boundary", () => {
  it("bounds only the work selection and preserves complete recomposition", async () => {
    const loadEligibleGroups = vi
      .fn<CanonicalizationRepository["loadEligibleGroups"]>()
      .mockResolvedValueOnce([group])
      .mockResolvedValueOnce([group]);
    const repository: CanonicalizationRepository = {
      loadEligibleGroups,
      resolveGroup: vi.fn<CanonicalizationRepository["resolveGroup"]>(
        async () => ({
          groupId: group.groupId,
          leadId: group.leadId,
          state: "linked",
          leadCreated: false,
          groupLinked: false,
        }),
      ),
      completeComposition: vi.fn(async () => ({
        leadId: group.leadId!,
        updated: false,
        revision: 1,
      })),
      claimSummaries: vi.fn(async () => []),
      completeSummary: vi.fn(),
      recordSummaryFailure: vi.fn(),
    };
    const summaryProvider: CanonicalSummaryProvider = {
      providerName: "openai",
      model: "synthetic-model",
      promptVersion: "synthetic-v1",
      summarize: vi.fn(),
    };

    await processCanonicalization({
      repository,
      summaryProvider,
      groupLimit: 25,
      summaryLimit: 10,
      summaryLeaseSeconds: 300,
    });

    expect(loadEligibleGroups).toHaveBeenNthCalledWith(1, 25);
    expect(loadEligibleGroups).toHaveBeenNthCalledWith(2);
  });
});
