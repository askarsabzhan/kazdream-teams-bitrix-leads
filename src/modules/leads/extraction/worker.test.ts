import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  GroupEvidenceItem,
  GroupExtractionClaim,
  GroupExtractionRepository,
} from "./types";
import { validateGroupExtraction } from "./validation";
import { processGroupExtractionBatch } from "./worker";

const evidenceItems: GroupEvidenceItem[] = [
  {
    id: "msg:1:text",
    type: "teams_text",
    teamsMessageId: "60000000-0000-4000-8000-000000000001",
    attachmentId: null,
    text: "Name: SYNTHETIC_PERSON; Phone: +000 000 0000001; normal client",
  },
];

const providerOutput = {
  person: {
    full_name: {
      value: "SYNTHETIC_PERSON",
      evidence_ids: ["msg:1:text"],
      status: "supported" as const,
    },
    company: { value: null, evidence_ids: [], status: "uncertain" as const },
    job_title: { value: null, evidence_ids: [], status: "uncertain" as const },
  },
  phones: [{ value: "+000 000 0000001", evidence_ids: ["msg:1:text"] }],
  emails: [],
  relationship_indicators: [],
  product_interests: [],
  region: { value: null, evidence_ids: [], status: "uncertain" as const },
  priority: { value: null, evidence_ids: [], status: "uncertain" as const },
  facts: [],
};

const claim: GroupExtractionClaim = {
  groupId: "61000000-0000-4000-8000-000000000001",
  campaignId: null,
  leaseId: "62000000-0000-4000-8000-000000000001",
  groupingRevision: 1,
  groupingAlgorithmVersion: "v1",
  extractionSourceFingerprint: "a".repeat(64),
  extractionRevision: 1,
  extractionAttempts: 1,
  providerName: "openai",
  providerModel: "gpt-4o-mini",
  promptVersion: "group-candidate-v1",
  schemaVersion: "group-candidate-schema-v2",
  evidenceItems,
};

describe("group extraction worker", () => {
  it("maps one durable claim to one provider request and emits no PII logs", async () => {
    const extraction = validateGroupExtraction(providerOutput, evidenceItems);
    const complete = vi.fn(async () => extraction.fieldEvidence.length);
    const recordOutcome = vi.fn(async () => undefined);
    const extract = vi.fn(async () => ({
      output: providerOutput,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        audioDurationMs: null,
      },
    }));
    const repository: GroupExtractionRepository = {
      claim: vi.fn(async () => [claim]),
      complete,
      recordOutcome,
      loadVerificationSnapshots: vi.fn(async () => [
        {
          groupId: claim.groupId,
          extractionRevision: 1,
          candidate: extraction.candidate,
          evidenceItems,
          fieldEvidence: extraction.fieldEvidence.map((row) => ({
            extractionRevision: 1,
            fieldName: row.fieldName,
            evidenceRefId: row.evidenceRefId,
            teamsMessageId: row.teamsMessageId,
            attachmentId: row.attachmentId,
            method: row.method,
            validationStatus: row.validationStatus,
          })),
        },
      ]),
    };
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const summary = await processGroupExtractionBatch({
      repository,
      provider: {
        providerName: "openai",
        model: "gpt-4o-mini",
        promptVersion: "group-candidate-v1",
        schemaVersion: "group-candidate-schema-v2",
        extract,
      },
      limit: 10,
      leaseSeconds: 300,
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(summary.openaiRequests).toBe(1);
    expect(summary.groupsProcessed).toBe(1);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it("rejects a claim configuration mismatch before a provider request", async () => {
    const extract = vi.fn();
    const recordOutcome = vi.fn(async () => undefined);
    const repository: GroupExtractionRepository = {
      claim: vi.fn(async () => [{ ...claim, providerModel: "unexpected-model" }]),
      complete: vi.fn(async () => 0),
      recordOutcome,
      loadVerificationSnapshots: vi.fn(async () => []),
    };

    const summary = await processGroupExtractionBatch({
      repository,
      provider: {
        providerName: "openai",
        model: "gpt-4o-mini",
        promptVersion: "group-candidate-v1",
        schemaVersion: "group-candidate-schema-v2",
        extract,
      },
      limit: 10,
      leaseSeconds: 300,
    });

    expect(extract).not.toHaveBeenCalled();
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "permanent_failed",
        errorCode: "GROUP_EXTRACTION_CONFIGURATION_MISMATCH",
      }),
    );
    expect(summary.failed).toBe(1);
    expect(summary.openaiRequests).toBe(0);
  });
});
