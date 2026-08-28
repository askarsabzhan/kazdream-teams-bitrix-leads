import { describe, expect, it } from "vitest";

import { groupConversationMessages, groupingNeedsReassessment } from "./engine";
import type { GroupableMessage } from "./types";

const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
] as const;

function message(options: {
  index: number;
  body?: string;
  author?: string | null;
  externalId?: string;
  replyTo?: string | null;
  seconds?: number;
  ready?: boolean;
  transcript?: string;
  ocr?: string;
}): GroupableMessage {
  const id = IDS[options.index] ?? `00000000-0000-4000-8000-${String(
    options.index + 1,
  ).padStart(12, "0")}`;
  return {
    id,
    campaignId: null,
    source: "teams",
    tenantId: "tenant",
    teamId: "team",
    channelId: "channel",
    externalMessageId: options.externalId ?? `external-${options.index}`,
    authorTeamsUserId: options.author === undefined ? "manager-a" : options.author,
    replyToExternalMessageId: options.replyTo ?? null,
    sourceCreatedAt: new Date(
      Date.parse("2026-01-01T00:00:00Z") + (options.seconds ?? 0) * 1000,
    ).toISOString(),
    bodyContent: options.body ?? null,
    contentRevision: 1,
    inputFingerprint: String(options.index + 1).padStart(64, "a"),
    evidenceReady: options.ready ?? true,
    isBot: false,
    isServiceMessage: false,
    attachments: [
      ...(options.transcript
        ? [
            {
              fetchState: "fetched",
              processingState: "processed",
              operation: "transcription" as const,
              transcriptText: options.transcript,
              ocrText: null,
            },
          ]
        : []),
      ...(options.ocr
        ? [
            {
              fetchState: "fetched",
              processingState: "processed",
              operation: "image_text" as const,
              transcriptText: null,
              ocrText: options.ocr,
            },
          ]
        : []),
    ],
    currentGroupingState: "pending",
    currentAlgorithmVersion: null,
    currentGroupingFingerprint: null,
    currentGroupingReason: null,
    currentGroupKey: null,
  };
}

function decisionFor(
  decisions: ReturnType<typeof groupConversationMessages>,
  messageId: string,
) {
  return decisions.find((decision) => decision.messageId === messageId);
}

describe("conversation grouping engine", () => {
  it("groups an exact email match for the same manager", () => {
    const sources = [
      message({ index: 0, body: "UNIT@EXAMPLE.INVALID" }),
      message({ index: 1, body: "unit@example.invalid", seconds: 300 }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
    expect(decisionFor(decisions, sources[1]!.id)?.reason).toBe("exact_email");
  });

  it("groups an exact normalized phone match", () => {
    const sources = [
      message({ index: 0, body: "+000 (000) 000-01" }),
      message({ index: 1, body: "+00000000001", seconds: 5 }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
    expect(decisionFor(decisions, sources[1]!.id)?.reason).toBe("exact_phone");
  });

  it("groups an explicit reply with its root before heuristics", () => {
    const sources = [
      message({ index: 0, externalId: "root" }),
      message({
        index: 1,
        externalId: "reply",
        replyTo: "root",
        author: "manager-b",
      }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
    expect(decisionFor(decisions, sources[1]!.id)?.reason).toBe(
      "explicit_reply",
    );
  });

  it("keeps three different contacts in forty seconds separate", () => {
    const sources = [
      message({ index: 0, body: "contact-a@example.invalid", seconds: 0 }),
      message({ index: 1, body: "contact-b@example.invalid", seconds: 10 }),
      message({ index: 2, body: "contact-c@example.invalid", seconds: 20 }),
    ];
    const keys = groupConversationMessages(sources).map(
      (decision) => decision.groupKey,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("keeps independent manager encounters separate despite exact identity", () => {
    const sources = [
      message({ index: 0, body: "unit@example.invalid", author: "manager-a" }),
      message({
        index: 1,
        body: "unit@example.invalid",
        author: "manager-b",
      }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).not.toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
  });

  it("groups photo and audio evidence through shared identity", () => {
    const sources = [
      message({ index: 0, ocr: "unit@example.invalid" }),
      message({ index: 1, transcript: "UNIT@EXAMPLE.INVALID", seconds: 900 }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
  });

  it("does not treat different phones as hard negatives", () => {
    const hints = "Name: PLACEHOLDER CONTACT\nCompany: PLACEHOLDER ORG";
    const sources = [
      message({ index: 0, body: `${hints}\n+00000000001` }),
      message({ index: 1, body: `${hints}\n+00000000002` }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
    expect(decisionFor(decisions, sources[1]!.id)?.reason).toBe("name_company");
  });

  it("never merges on time and author alone", () => {
    const decisions = groupConversationMessages([
      message({ index: 0, body: "continuation only", seconds: 0 }),
      message({ index: 1, body: "another continuation", seconds: 1 }),
    ]);
    expect(decisions.every((decision) => decision.state === "ambiguous")).toBe(
      true,
    );
  });

  it("attaches a late strong match to the existing encounter", () => {
    const sources = [
      message({ index: 0, body: "unit@example.invalid", seconds: 0 }),
      message({ index: 1, body: "UNIT@EXAMPLE.INVALID", seconds: 86_400 }),
    ];
    const decisions = groupConversationMessages(sources);
    expect(decisionFor(decisions, sources[0]!.id)?.groupKey).toBe(
      decisionFor(decisions, sources[1]!.id)?.groupKey,
    );
  });

  it("leaves insufficient standalone evidence unresolved", () => {
    const source = message({ index: 0, body: "send proposal later" });
    expect(groupConversationMessages([source])[0]).toMatchObject({
      state: "ambiguous",
      groupKey: null,
      reason: "ambiguous_unassigned",
    });
  });

  it("reassesses an ambiguous message when new evidence becomes available", () => {
    const existing = message({ index: 0, body: "unit@example.invalid" });
    const initiallyAmbiguous = message({ index: 1, body: "continuation only" });
    expect(groupConversationMessages([initiallyAmbiguous])[0]?.state).toBe(
      "ambiguous",
    );

    const reassessed = message({
      index: 1,
      body: "continuation only",
      ocr: "UNIT@EXAMPLE.INVALID",
    });
    reassessed.currentGroupingState = "ambiguous";
    reassessed.currentAlgorithmVersion = "v1";
    reassessed.currentGroupingFingerprint = initiallyAmbiguous.inputFingerprint;
    reassessed.inputFingerprint = "f".repeat(64);

    expect(
      groupingNeedsReassessment({
        currentAlgorithmVersion: reassessed.currentAlgorithmVersion,
        currentSourceFingerprint: reassessed.currentGroupingFingerprint,
        nextSourceFingerprint: reassessed.inputFingerprint,
      }),
    ).toBe(true);
    const decisions = groupConversationMessages([existing, reassessed]);
    expect(decisionFor(decisions, reassessed.id)).toMatchObject({
      state: "grouped",
      groupKey: decisionFor(decisions, existing.id)?.groupKey,
      reason: "exact_email",
    });
  });

  it("defers a source while attachment evidence is non-terminal", () => {
    const source = message({ index: 0, body: "unit@example.invalid", ready: false });
    expect(groupConversationMessages([source])[0]).toMatchObject({
      state: "deferred",
      reason: "evidence_pending",
    });
  });

  it("excludes terminal unavailable attachment content", () => {
    const unavailable = message({ index: 0 });
    unavailable.attachments = [
      {
        fetchState: "unsupported",
        processingState: "processed",
        operation: "transcription",
        transcriptText: "unit@example.invalid",
        ocrText: null,
      },
    ];
    const available = message({ index: 1, body: "unit@example.invalid" });
    const decisions = groupConversationMessages([unavailable, available]);
    expect(decisionFor(decisions, unavailable.id)?.state).toBe("ambiguous");
    expect(decisionFor(decisions, available.id)?.state).toBe("grouped");
  });

  it("is deterministic on replay", () => {
    const sources = [
      message({ index: 0, body: "unit@example.invalid" }),
      message({ index: 1, body: "UNIT@EXAMPLE.INVALID" }),
    ];
    expect(groupConversationMessages(sources)).toEqual(
      groupConversationMessages(sources),
    );
  });

  it("reassesses intentionally when the algorithm version changes", () => {
    expect(
      groupingNeedsReassessment({
        currentAlgorithmVersion: "v1",
        currentSourceFingerprint: "a".repeat(64),
        nextAlgorithmVersion: "v2",
        nextSourceFingerprint: "a".repeat(64),
      }),
    ).toBe(true);
  });
});
