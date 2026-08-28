import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { GroupCandidatePayload } from "../extraction/types";

import { composeCanonicalLead } from "./composition";
import type {
  CanonicalizationRepository,
  CanonicalSummaryClaim,
  CanonicalSummaryProvider,
  EligibleCanonicalGroup,
} from "./types";
import { processCanonicalization } from "./worker";

const candidate: GroupCandidatePayload = {
  person: {
    fullName: {
      value: "Synthetic Person",
      evidenceIds: ["msg:1:text"],
      status: "supported",
    },
    company: {
      value: "Synthetic Company",
      evidenceIds: ["msg:1:text"],
      status: "supported",
    },
    jobTitle: { value: null, evidenceIds: [], status: "uncertain" },
  },
  phones: [{ value: "+49 511 1000001", evidenceIds: ["msg:1:text"] }],
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
      authorTeamsUserId: "manager-1",
      sourceCreatedAt: "2026-08-28T10:00:01Z",
    },
  ],
};

const summaryProvider: CanonicalSummaryProvider = {
  providerName: "openai",
  model: "gpt-4o-mini",
  promptVersion: "canonical-summary-ru-v1",
  summarize: vi.fn(async () => ({
    summaryRu: "Подтверждён краткий аналитический итог по синтетическому лиду.",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      audioDurationMs: null,
    },
  })),
};

function repository(
  overrides: Partial<CanonicalizationRepository> = {},
): CanonicalizationRepository {
  return {
    loadEligibleGroups: vi.fn(async () => []),
    resolveGroup: vi.fn(),
    completeComposition: vi.fn(),
    claimSummaries: vi.fn(async () => []),
    completeSummary: vi.fn(),
    recordSummaryFailure: vi.fn(),
    ...overrides,
  };
}

function claim(): CanonicalSummaryClaim {
  return {
    leadId: group.leadId!,
    leaseId: "74000000-0000-4000-8000-000000000001",
    sourceFingerprint: "b".repeat(64),
    revision: 1,
    attempts: 1,
    provider: summaryProvider.providerName,
    model: summaryProvider.model,
    promptVersion: summaryProvider.promptVersion,
    candidate: composeCanonicalLead([group]).payload,
    evidence: [
      {
        groupRef: group.groupId,
        evidenceRef: "msg:1:text",
        evidenceType: "teams_text",
        text: "Synthetic evidence",
      },
    ],
  };
}

describe("canonicalization orchestration", () => {
  it("keeps an exact canonical replay as a complete no-op", async () => {
    const testRepository = repository({
      loadEligibleGroups: vi.fn(async () => [group]),
      resolveGroup: vi.fn<CanonicalizationRepository["resolveGroup"]>(async () => ({
        groupId: group.groupId,
        leadId: group.leadId,
        state: "linked",
        leadCreated: false,
        groupLinked: false,
      })),
      completeComposition: vi.fn(async () => ({
        leadId: group.leadId!,
        updated: false,
        revision: 1,
      })),
    });

    const result = await processCanonicalization({
      repository: testRepository,
      summaryProvider,
      summaryLimit: 10,
      summaryLeaseSeconds: 300,
    });

    expect(result).toMatchObject({
      groupsSeen: 1,
      canonicalLeadsCreated: 0,
      canonicalLeadsUpdated: 0,
      groupsLinked: 0,
      summaryRequests: 0,
      summariesCompleted: 0,
    });
    expect(summaryProvider.summarize).not.toHaveBeenCalled();
  });

  it("calls the summary provider once for a durable claim and not on replay", async () => {
    const pendingClaim = claim();
    const testRepository = repository({
      claimSummaries: vi
        .fn<CanonicalizationRepository["claimSummaries"]>()
        .mockResolvedValueOnce([pendingClaim])
        .mockResolvedValueOnce([]),
    });

    const first = await processCanonicalization({
      repository: testRepository,
      summaryProvider,
      summaryLimit: 10,
      summaryLeaseSeconds: 300,
    });
    const replay = await processCanonicalization({
      repository: testRepository,
      summaryProvider,
      summaryLimit: 10,
      summaryLeaseSeconds: 300,
    });

    expect(first).toMatchObject({
      summaryRequests: 1,
      summariesCompleted: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(replay).toMatchObject({ summaryRequests: 0, summariesCompleted: 0 });
    expect(summaryProvider.summarize).toHaveBeenCalledTimes(1);
    expect(testRepository.completeSummary).toHaveBeenCalledTimes(1);
  });
});
