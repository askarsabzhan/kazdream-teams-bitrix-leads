import type { SyntheticAttachment, SyntheticMessage } from "./types";

interface EncounterSpec {
  encounterId: string;
  canonicalNumber: number | null;
  managerId: string;
  startOffsetSeconds: number;
  texts: string[];
  messageOffsets?: number[];
  attachments?: Record<number, SyntheticAttachment[]>;
}

const BASE_TIME_MS = Date.parse("2026-01-15T09:00:00.000Z");

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function fullName(number: number): string {
  const names = [
    "Avery", "Blake", "Casey", "Devon", "Ellis", "Finley", "Gray", "Harper",
    "Indigo", "Jordan", "Kai", "Logan", "Morgan", "Noel", "Oakley", "Parker",
    "Quinn", "Reese", "Sage", "Taylor", "Vale", "Winter",
  ];
  return `${names[number - 1]!} Example`;
}

function phone(number: number, suffix = 0): string {
  return `+1 202 555 ${String(100 + number + suffix * 100).padStart(4, "0")}`;
}

function email(number: number, suffix = 0): string {
  const tag = suffix === 0 ? "" : `-${suffix + 1}`;
  return `visitor${twoDigits(number)}${tag}@synthetic.example`;
}

function company(number: number): string {
  return `Example Works ${twoDigits(number)}`;
}

function standardEncounter(options: {
  encounterId: string;
  canonicalNumber: number;
  managerId: string;
  startOffsetSeconds: number;
  messageCount?: 2 | 3;
  relationship?: "partner" | "customer";
  emailOverride?: string | null;
  extraPhone?: boolean;
  extraEmail?: boolean;
}): EncounterSpec {
  const relationship = options.relationship === "partner"
    ? "Relationship: system integrator partner"
    : options.relationship === "customer"
      ? "Relationship: explicit customer"
      : "Interest: Analytics";
  const emailValue = options.emailOverride === undefined
    ? email(options.canonicalNumber)
    : options.emailOverride;
  const phoneLine = options.extraPhone
    ? `Phone: ${phone(options.canonicalNumber)}\nPhone: ${phone(options.canonicalNumber, 1)}`
    : `Phone: ${phone(options.canonicalNumber)}`;
  const emailLine = emailValue === null
    ? ""
    : options.extraEmail
      ? `Email: ${emailValue}\nEmail: ${email(options.canonicalNumber, 1)}`
      : `Email: ${emailValue}`;
  const texts = options.messageCount === 3
    ? [
        `Name: ${fullName(options.canonicalNumber)}`,
        phoneLine + (emailLine ? `\n${emailLine}` : ""),
        `Company: ${company(options.canonicalNumber)}\n${relationship}`,
      ]
    : [
        `Name: ${fullName(options.canonicalNumber)}\n${phoneLine}`,
        [emailLine, `Company: ${company(options.canonicalNumber)}`, relationship]
          .filter(Boolean)
          .join("\n"),
      ];
  return { ...options, texts };
}

const encounters: EncounterSpec[] = [
  standardEncounter({ encounterId: "enc-01", canonicalNumber: 1, managerId: "manager-a", startOffsetSeconds: 0, messageCount: 3 }),
  standardEncounter({ encounterId: "enc-02", canonicalNumber: 2, managerId: "manager-a", startOffsetSeconds: 90, messageCount: 3 }),
  {
    encounterId: "enc-03",
    canonicalNumber: 3,
    managerId: "manager-b",
    startOffsetSeconds: 210,
    texts: [
      `Company: ${company(3)}\nDiscussion continued in replies`,
      `Name: ${fullName(3)}\nPhone: ${phone(3)}\nEmail: ${email(3)}`,
    ],
  },
  standardEncounter({ encounterId: "enc-04", canonicalNumber: 4, managerId: "manager-c", startOffsetSeconds: 600 }),
  standardEncounter({ encounterId: "enc-05", canonicalNumber: 5, managerId: "manager-c", startOffsetSeconds: 620 }),
  standardEncounter({ encounterId: "enc-06", canonicalNumber: 6, managerId: "manager-c", startOffsetSeconds: 635 }),
  standardEncounter({ encounterId: "enc-07-a", canonicalNumber: 7, managerId: "manager-a", startOffsetSeconds: 900 }),
  standardEncounter({ encounterId: "enc-07-b", canonicalNumber: 7, managerId: "manager-b", startOffsetSeconds: 1_200 }),
  standardEncounter({ encounterId: "enc-08", canonicalNumber: 8, managerId: "manager-a", startOffsetSeconds: 1_500, extraPhone: true }),
  standardEncounter({ encounterId: "enc-09", canonicalNumber: 9, managerId: "manager-b", startOffsetSeconds: 1_800, extraEmail: true }),
  standardEncounter({ encounterId: "enc-10", canonicalNumber: 10, managerId: "manager-c", startOffsetSeconds: 2_100, emailOverride: "visitor10@synthetic.corn" }),
  standardEncounter({ encounterId: "enc-11", canonicalNumber: 11, managerId: "manager-a", startOffsetSeconds: 2_400, emailOverride: null }),
  standardEncounter({ encounterId: "enc-12", canonicalNumber: 12, managerId: "manager-b", startOffsetSeconds: 2_700, relationship: "partner" }),
  standardEncounter({ encounterId: "enc-13", canonicalNumber: 13, managerId: "manager-c", startOffsetSeconds: 3_000 }),
  standardEncounter({ encounterId: "enc-14", canonicalNumber: 14, managerId: "manager-a", startOffsetSeconds: 3_300, relationship: "customer" }),
  {
    encounterId: "enc-15-a",
    canonicalNumber: 15,
    managerId: "manager-a",
    startOffsetSeconds: 3_600,
    texts: [
      `Name: ${fullName(15)}\nPhone: ${phone(15)}`,
      "Interest: Platform/Core",
    ],
  },
  {
    encounterId: "enc-15-b",
    canonicalNumber: 15,
    managerId: "manager-d",
    startOffsetSeconds: 7_200,
    texts: [
      `Name: ${fullName(15)}\nPhone: ${phone(15)}`,
      `Email: ${email(15)}\nCompany: ${company(15)}\nPriority: urgent`,
    ],
  },
  {
    encounterId: "enc-16",
    canonicalNumber: 16,
    managerId: "manager-b",
    startOffsetSeconds: 4_000,
    messageOffsets: [0, 7_200],
    texts: [
      `Name: ${fullName(16)}\nPhone: ${phone(16)}`,
      `Email: ${email(16)}\nCompany: ${company(16)}\nLate explicit reply`,
    ],
  },
  {
    encounterId: "enc-17",
    canonicalNumber: 17,
    managerId: "manager-c",
    startOffsetSeconds: 4_300,
    texts: [
      `Name: ${fullName(17)}\nPhone: ${phone(17)}`,
      `Email: ${email(17)}\nUnsupported attachment did not block source text`,
    ],
    attachments: {
      0: [{ fixtureId: 1, fetchState: "unsupported", processingState: "unsupported", operation: null, transcriptText: null, ocrText: null }],
    },
  },
  {
    encounterId: "enc-18",
    canonicalNumber: 18,
    managerId: "manager-a",
    startOffsetSeconds: 4_600,
    texts: ["Synthetic audio note attached", "Transcript reviewed"],
    attachments: {
      0: [{ fixtureId: 2, fetchState: "fetched", processingState: "processed", operation: "transcription", transcriptText: `Name: ${fullName(18)}\nPhone: ${phone(18)}\nEmail: ${email(18)}`, ocrText: null }],
    },
  },
  {
    encounterId: "enc-19",
    canonicalNumber: 19,
    managerId: "manager-b",
    startOffsetSeconds: 4_900,
    texts: ["Synthetic badge image attached", "OCR reviewed"],
    attachments: {
      0: [{ fixtureId: 3, fetchState: "fetched", processingState: "processed", operation: "image_text", transcriptText: null, ocrText: `Name: ${fullName(19)}\nPhone: ${phone(19)}\nEmail: ${email(19)}` }],
    },
  },
  standardEncounter({ encounterId: "enc-20-a", canonicalNumber: 20, managerId: "manager-e", startOffsetSeconds: 5_200 }),
  standardEncounter({ encounterId: "enc-20-b", canonicalNumber: 20, managerId: "manager-f", startOffsetSeconds: 8_200 }),
  standardEncounter({ encounterId: "enc-21", canonicalNumber: 21, managerId: "manager-c", startOffsetSeconds: 5_500 }),
  standardEncounter({ encounterId: "enc-22", canonicalNumber: 22, managerId: "manager-d", startOffsetSeconds: 5_800 }),
  {
    encounterId: "ineligible-email-only",
    canonicalNumber: null,
    managerId: "manager-a",
    startOffsetSeconds: 6_100,
    texts: ["Name: Emailonly Example\nEmail: emailonly@synthetic.example", "Company: Example Email Only"],
  },
  {
    encounterId: "ineligible-missing-name",
    canonicalNumber: null,
    managerId: "manager-b",
    startOffsetSeconds: 6_400,
    texts: ["Phone: +1 202 555 0191\nCompany: Example Nameless", "Interest: Support & SLA"],
  },
  {
    encounterId: "ineligible-name-conflict",
    canonicalNumber: null,
    managerId: "manager-c",
    startOffsetSeconds: 6_700,
    texts: ["Name: First Conflict\nPhone: +1 202 555 0192", "Name: Second Conflict\nCustomer requested follow-up"],
  },
];

function buildMessages(): SyntheticMessage[] {
  let sequence = 0;
  const messages: SyntheticMessage[] = [];
  for (const encounter of encounters) {
    const rootExternalId = `eval-root-${encounter.encounterId}`;
    encounter.texts.forEach((text, index) => {
      sequence += 1;
      const offset = encounter.messageOffsets?.[index] ?? index * 5;
      messages.push({
        sequence,
        encounterId: encounter.encounterId,
        id: `message-${String(sequence).padStart(3, "0")}`,
        campaignId: null,
        source: "evaluation",
        tenantId: "synthetic-tenant",
        teamId: "synthetic-team",
        channelId: "synthetic-channel",
        externalMessageId: index === 0 ? rootExternalId : `${rootExternalId}-reply-${index}`,
        authorTeamsUserId: encounter.managerId,
        replyToExternalMessageId: index === 0 ? null : rootExternalId,
        sourceCreatedAt: new Date(BASE_TIME_MS + (encounter.startOffsetSeconds + offset) * 1_000).toISOString(),
        bodyContent: text,
        contentRevision: 1,
        inputFingerprint: `evaluation:${sequence}:revision:1`,
        evidenceReady: true,
        isBot: false,
        isServiceMessage: false,
        attachments: encounter.attachments?.[index] ?? [],
        currentGroupingState: "pending",
        currentAlgorithmVersion: null,
        currentGroupingFingerprint: null,
        currentGroupingReason: null,
        currentGroupKey: null,
      });
    });
  }
  sequence += 1;
  messages.push({
    sequence,
    encounterId: null,
    id: `message-${String(sequence).padStart(3, "0")}`,
    campaignId: null,
    source: "evaluation",
    tenantId: "synthetic-tenant",
    teamId: "synthetic-team",
    channelId: "synthetic-channel",
    externalMessageId: "eval-bot-service",
    authorTeamsUserId: null,
    replyToExternalMessageId: null,
    sourceCreatedAt: new Date(BASE_TIME_MS + 7_000_000).toISOString(),
    bodyContent: "Automated booth service notification",
    contentRevision: 1,
    inputFingerprint: `evaluation:${sequence}:revision:1`,
    evidenceReady: true,
    isBot: true,
    isServiceMessage: true,
    attachments: [],
    currentGroupingState: "pending",
    currentAlgorithmVersion: null,
    currentGroupingFingerprint: null,
    currentGroupingReason: null,
    currentGroupKey: null,
  });
  sequence += 1;
  messages.push({
    sequence,
    encounterId: null,
    id: `message-${String(sequence).padStart(3, "0")}`,
    campaignId: null,
    source: "evaluation",
    tenantId: "synthetic-tenant",
    teamId: "synthetic-team",
    channelId: "synthetic-channel",
    externalMessageId: "eval-weak-context",
    authorTeamsUserId: "manager-d",
    replyToExternalMessageId: null,
    sourceCreatedAt: new Date(BASE_TIME_MS + 7_100_000).toISOString(),
    bodyContent: "Interesting conversation near the exhibition entrance",
    contentRevision: 1,
    inputFingerprint: `evaluation:${sequence}:revision:1`,
    evidenceReady: true,
    isBot: false,
    isServiceMessage: false,
    attachments: [],
    currentGroupingState: "pending",
    currentAlgorithmVersion: null,
    currentGroupingFingerprint: null,
    currentGroupingReason: null,
    currentGroupKey: null,
  });
  return messages;
}

export const SYNTHETIC_MESSAGES = buildMessages();
