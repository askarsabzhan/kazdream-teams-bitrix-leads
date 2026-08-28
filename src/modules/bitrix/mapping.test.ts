import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyBitrixFailure } from "./errors";
import { formatCrmSyncSummary } from "./format";
import { buildBitrixLeadFields, buildSourceTimelineComment } from "./mapping";
import type {
  BitrixDiscoveryConfiguration,
  CrmSyncClaim,
} from "./types";

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
    [
      "UF_CRM_PRODUCT_INTEREST",
      "UF_CRM_TEAMS_GROUP_ID",
      "UF_CRM_TEAMS_MESSAGE_IDS",
      "UF_CRM_TEAMS_AUTHOR",
    ].map((name) => [
      name,
      {
        name,
        type: name === "UF_CRM_PRODUCT_INTEREST" ? "enumeration" : "string",
        multiple: name === "UF_CRM_PRODUCT_INTEREST",
        required: false,
        items: [],
      },
    ]),
  ),
};

function claim(): CrmSyncClaim {
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
        company: { value: "Synthetic Company", status: "supported", groupIds: [groupId] },
        jobTitle: { value: "Director", status: "supported", groupIds: [groupId] },
      },
      phones: [{ value: "+49 511 1000001", normalizedValue: "+495111000001", groupIds: [groupId] }],
      emails: [{ value: "synthetic@example.test", normalizedValue: "synthetic@example.test", groupIds: [groupId] }],
      relationshipIndicators: [],
      productInterests: [
        { value: "Platform/Core", groupIds: [groupId] },
        { value: "Analytics", groupIds: [groupId] },
      ],
      region: { value: "Europe", groupIds: [groupId] },
      priority: { value: "High", groupIds: [groupId] },
      facts: [],
      leadType: { value: "Partner", status: "supported", groupIds: [groupId] },
      campaign: {
        exhibition: "Hannover Messe 2026",
        exhibitionBitrixId: 63,
        source: "EXHIBITION",
      },
    },
    summaryRu: "Краткое синтетическое аналитическое резюме на русском языке.",
    groupIds: [groupId],
    teamsMessageIds: ["synthetic-message-1"],
    sourceEvidence: [
      { evidenceType: "teams_text", text: "Original synthetic manager speech" },
      { evidenceType: "transcript", text: "Verbatim synthetic transcript" },
    ],
    cachedManagerMappings: [],
  };
}

describe("canonical lead to Bitrix mapping", () => {
  it("maps canonical fields, enums, contacts and the latest owner", () => {
    const fields = buildBitrixLeadFields({
      claim: claim(),
      assignedBitrixUserId: 501,
      managerEmail: "manager@example.test",
      discovery,
    });

    expect(fields).toMatchObject({
      TITLE: "Synthetic Person — Synthetic Company",
      NAME: "Synthetic Person",
      COMPANY_TITLE: "Synthetic Company",
      POST: "Director",
      COMMENTS: "Краткое синтетическое аналитическое резюме на русском языке.",
      SOURCE_ID: "EXHIBITION",
      ASSIGNED_BY_ID: 501,
      UF_CRM_LEAD_TYPE: 45,
      UF_CRM_REGION: 49,
      UF_CRM_EXHIBITION: 63,
      UF_CRM_PRODUCT_INTEREST: [71, 73],
      UF_CRM_PRIORITY: 83,
      UF_CRM_TEAMS_GROUP_ID: groupId,
      UF_CRM_TEAMS_MESSAGE_IDS: '["synthetic-message-1"]',
      UF_CRM_TEAMS_AUTHOR: "manager@example.test",
    });
    expect(fields.PHONE).toEqual([{ VALUE: "+49 511 1000001", VALUE_TYPE: "WORK" }]);
    expect(fields.EMAIL).toEqual([{ VALUE: "synthetic@example.test", VALUE_TYPE: "WORK" }]);
  });

  it.each([
    ["Partner", 45],
    ["Customer", 47],
  ] as const)("maps %s without reclassification", (value, expected) => {
    const input = claim();
    input.canonicalPayload.leadType.value = value;
    expect(buildBitrixLeadFields({
      claim: input,
      assignedBitrixUserId: 501,
      managerEmail: "manager@example.test",
      discovery,
    }).UF_CRM_LEAD_TYPE).toBe(expected);
  });

  it("omits unsupported null region, priority, company, job title and email", () => {
    const input = claim();
    input.canonicalPayload.person.company = { value: null, status: "uncertain", groupIds: [] };
    input.canonicalPayload.person.jobTitle = { value: null, status: "uncertain", groupIds: [] };
    input.canonicalPayload.emails = [];
    input.canonicalPayload.region = { value: null, groupIds: [] };
    input.canonicalPayload.priority = { value: null, groupIds: [] };
    const fields = buildBitrixLeadFields({
      claim: input,
      assignedBitrixUserId: 501,
      managerEmail: "manager@example.test",
      discovery,
    });
    expect(fields).not.toHaveProperty("COMPANY_TITLE");
    expect(fields).not.toHaveProperty("POST");
    expect(fields).not.toHaveProperty("EMAIL");
    expect(fields).not.toHaveProperty("UF_CRM_REGION");
    expect(fields).not.toHaveProperty("UF_CRM_PRIORITY");
  });

  it("keeps original source material separate from COMMENTS", () => {
    const input = claim();
    const comment = buildSourceTimelineComment(input);
    const fields = buildBitrixLeadFields({
      claim: input,
      assignedBitrixUserId: 501,
      managerEmail: "manager@example.test",
      discovery,
    });
    expect(comment).toContain(input.sourceCommentMarker);
    expect(comment).toContain("Original synthetic manager speech");
    expect(comment).toContain("Verbatim synthetic transcript");
    expect(comment).not.toContain(input.summaryRu);
    expect(fields.COMMENTS).toBe(input.summaryRu);
  });

  it("classifies rate limits as retryable and keeps operational output PII-safe", () => {
    expect(classifyBitrixFailure({
      httpStatus: 503,
      remoteCode: "QUERY_LIMIT_EXCEEDED",
    }).outcome).toBe("retryable_failed");
    expect(classifyBitrixFailure({
      httpStatus: 429,
      remoteCode: "OPERATION_TIME_LIMIT",
    }).outcome).toBe("retryable_failed");
    const output = formatCrmSyncSummary({
      outboxSeen: 1,
      created: 1,
      updated: 0,
      recovered: 0,
      blocked: 0,
      failed: 0,
    });
    expect(output).not.toContain("Synthetic Person");
    expect(output).not.toContain("synthetic@example.test");
    expect(output).not.toContain("webhook");
  });
});
