import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  BitrixDiscoveryConfiguration,
  BitrixLeadGateway,
  BitrixUserGateway,
  CrmSyncClaim,
  CrmSyncRepository,
  TeamsManagerDirectory,
} from "./types";
import { processCrmSync } from "./worker";

const groupId = "71000000-0000-4000-8000-000000000001";
const leadId = "73000000-0000-4000-8000-000000000001";

const discovery: BitrixDiscoveryConfiguration = {
  checks: {
    BITRIX_WEBHOOK_AUTH: true,
    BITRIX_REQUIRED_FIELDS: true,
    BITRIX_ENUMS: true,
    BITRIX_TEAMS_FIELDS: true,
    BITRIX_USER_DIRECTORY: true,
  },
  fields: Object.fromEntries(
    ["UF_CRM_PRODUCT_INTEREST", "UF_CRM_TEAMS_GROUP_ID", "UF_CRM_TEAMS_MESSAGE_IDS", "UF_CRM_TEAMS_AUTHOR"].map((name) => [
      name,
      { name, type: "string", multiple: false, required: false, items: [] },
    ]),
  ),
};

function claim(overrides: Partial<CrmSyncClaim> = {}): CrmSyncClaim {
  return {
    outboxId: "74000000-0000-4000-8000-000000000001",
    leaseId: "75000000-0000-4000-8000-000000000001",
    attempts: 1,
    leadId,
    leadRevision: 1,
    localBitrixLeadId: null,
    outboxBitrixLeadId: null,
    syncAction: null,
    crmCompletedAt: null,
    sourceCommentState: "pending",
    sourceCommentMarker: `[KD-SOURCE:${leadId}:r1]`,
    bitrixSourceGroupId: groupId,
    assignedTeamsUserId: "manager-aad-id",
    canonicalPayload: {
      person: {
        fullName: { value: "Synthetic Person", status: "supported", groupIds: [groupId] },
        company: { value: null, status: "uncertain", groupIds: [] },
        jobTitle: { value: null, status: "uncertain", groupIds: [] },
      },
      phones: [{ value: "+49 511 1000001", normalizedValue: "+495111000001", groupIds: [groupId] }],
      emails: [],
      relationshipIndicators: [],
      productInterests: [],
      region: { value: null, groupIds: [] },
      priority: { value: null, groupIds: [] },
      facts: [],
      leadType: { value: "Customer", status: "defaulted", groupIds: [groupId] },
      campaign: { exhibition: "Hannover Messe 2026", exhibitionBitrixId: 63, source: "EXHIBITION" },
    },
    summaryRu: "Краткое синтетическое аналитическое резюме на русском языке.",
    groupIds: [groupId],
    teamsMessageIds: ["synthetic-message-1"],
    sourceEvidence: [{ evidenceType: "teams_text", text: "Synthetic source" }],
    cachedManagerMappings: [],
    ...overrides,
  };
}

function repository(claims: CrmSyncClaim[]): CrmSyncRepository {
  return {
    claim: vi.fn(async () => claims),
    persistManagerMapping: vi.fn(async () => undefined),
    completeLeadDelivery: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
    loadVerificationTargets: vi.fn(async () => []),
  };
}

function directory(emails: string[] = ["manager@example.test"]): TeamsManagerDirectory {
  return { resolveEmails: vi.fn(async () => emails) };
}

function users(ids: number[] = [501]): BitrixUserGateway {
  return { findExactByEmail: vi.fn(async () => ids) };
}

function leads(overrides: Partial<BitrixLeadGateway> = {}): BitrixLeadGateway {
  return {
    lookupBySourceGroup: vi.fn(async () => []),
    add: vi.fn(async () => 901),
    update: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    addSourceComment: vi.fn(async () => 1001),
    ...overrides,
  };
}

async function run(options: {
  repository: CrmSyncRepository;
  teamsDirectory?: TeamsManagerDirectory;
  bitrixUsers?: BitrixUserGateway;
  bitrixLeads?: BitrixLeadGateway;
}) {
  return processCrmSync({
    repository: options.repository,
    teamsDirectory: options.teamsDirectory ?? directory(),
    bitrixUsers: options.bitrixUsers ?? users(),
    bitrixLeads: options.bitrixLeads ?? leads(),
    discovery,
    workerId: "test-worker",
    limit: 10,
    leaseSeconds: 300,
  });
}

describe("durable Bitrix synchronization", () => {
  it("uses exact manager email, looks up before create, and maps the latest owner", async () => {
    const events: string[] = [];
    const testRepository = repository([claim()]);
    const testLeads = leads({
      lookupBySourceGroup: vi.fn(async () => { events.push("lookup"); return []; }),
      add: vi.fn(async (fields) => {
        events.push("add");
        expect(fields.ASSIGNED_BY_ID).toBe(501);
        return 901;
      }),
    });
    const result = await run({ repository: testRepository, bitrixLeads: testLeads });

    expect(events).toEqual(["lookup", "add"]);
    expect(testRepository.persistManagerMapping).toHaveBeenCalledWith({
      teamsUserId: "manager-aad-id",
      email: "manager@example.test",
      bitrixUserId: 501,
    });
    expect(result).toMatchObject({ created: 1, blocked: 0, failed: 0 });
  });

  it("blocks missing and ambiguous manager mappings without CRM writes", async () => {
    const missingRepository = repository([claim()]);
    const missingLeads = leads();
    const missing = await run({
      repository: missingRepository,
      teamsDirectory: directory([]),
      bitrixLeads: missingLeads,
    });
    expect(missing.blocked).toBe(1);
    expect(missingLeads.lookupBySourceGroup).not.toHaveBeenCalled();
    expect(missingRepository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "MANAGER_MAPPING_MISSING", outcome: "blocked" }),
    );

    const ambiguousRepository = repository([claim()]);
    const ambiguousLeads = leads();
    const ambiguous = await run({
      repository: ambiguousRepository,
      bitrixUsers: users([501, 502]),
      bitrixLeads: ambiguousLeads,
    });
    expect(ambiguous.blocked).toBe(1);
    expect(ambiguousLeads.lookupBySourceGroup).not.toHaveBeenCalled();
    expect(ambiguousRepository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "MANAGER_MAPPING_AMBIGUOUS", outcome: "blocked" }),
    );
  });

  it("recovers an existing remote lead instead of creating another", async () => {
    const testRepository = repository([
      claim({ cachedManagerMappings: [{ bitrixUserId: 501, email: "manager@example.test" }] }),
    ]);
    const testLeads = leads({ lookupBySourceGroup: vi.fn(async () => [901]) });
    const result = await run({ repository: testRepository, bitrixLeads: testLeads });

    expect(testLeads.add).not.toHaveBeenCalled();
    expect(testLeads.update).toHaveBeenCalledTimes(1);
    expect(testRepository.completeLeadDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ bitrixLeadId: 901, action: "recovered" }),
    );
    expect(result.recovered).toBe(1);
  });

  it("does not duplicate after add succeeds and local finalization fails", async () => {
    const replayClaim = claim({
      attempts: 2,
      cachedManagerMappings: [{ bitrixUserId: 501, email: "manager@example.test" }],
    });
    const testRepository = repository([
      claim({ cachedManagerMappings: replayClaim.cachedManagerMappings }),
    ]);
    vi.mocked(testRepository.claim).mockResolvedValueOnce([
      claim({ cachedManagerMappings: replayClaim.cachedManagerMappings }),
    ]).mockResolvedValueOnce([replayClaim]);
    vi.mocked(testRepository.completeLeadDelivery)
      .mockRejectedValueOnce(new Error("synthetic finalize failure"))
      .mockResolvedValueOnce(undefined);
    const testLeads = leads({
      lookupBySourceGroup: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([901]),
    });

    const first = await run({ repository: testRepository, bitrixLeads: testLeads });
    const replay = await run({ repository: testRepository, bitrixLeads: testLeads });

    expect(first.failed).toBe(1);
    expect(replay.recovered).toBe(1);
    expect(testLeads.add).toHaveBeenCalledTimes(1);
    expect(testLeads.update).toHaveBeenCalledTimes(1);
  });

  it("uses crm.lead.update when the local Bitrix ID already exists", async () => {
    const testRepository = repository([
      claim({
        localBitrixLeadId: 901,
        cachedManagerMappings: [{ bitrixUserId: 501, email: "manager@example.test" }],
      }),
    ]);
    const testLeads = leads();
    const result = await run({ repository: testRepository, bitrixLeads: testLeads });

    expect(testLeads.lookupBySourceGroup).not.toHaveBeenCalled();
    expect(testLeads.add).not.toHaveBeenCalled();
    expect(testLeads.update).toHaveBeenCalledWith(901, expect.any(Object));
    expect(result.updated).toBe(1);
  });
});
