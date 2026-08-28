import { describe, expect, it } from "vitest";

import {
  rawGroupExtractionSchema,
  structuredGroupExtractionSchema,
  type RawGroupExtraction,
} from "./schema";
import type {
  GroupEvidenceItem,
  GroupExtractionVerificationSnapshot,
  ValidatedGroupExtraction,
} from "./types";
import {
  evaluateGroupExtractionChecks,
  validateGroupExtraction,
} from "./validation";

function evidence(
  id: string,
  text: string,
  type: GroupEvidenceItem["type"] = "teams_text",
): GroupEvidenceItem {
  return {
    id,
    type,
    teamsMessageId: `40000000-0000-4000-8000-${id.startsWith("msg:2") ? "000000000002" : "000000000001"}`,
    attachmentId: type === "transcript" || type === "ocr"
      ? "41000000-0000-4000-8000-000000000001"
      : null,
    text,
  };
}

function baseRaw(): RawGroupExtraction {
  return {
    person: {
      full_name: {
        value: "Alice Example",
        evidence_ids: ["msg:1:text"],
        status: "supported" as const,
      },
      company: {
        value: "Example GmbH",
        evidence_ids: ["msg:1:text"],
        status: "supported" as const,
      },
      job_title: {
        value: null,
        evidence_ids: [],
        status: "uncertain" as const,
      },
    },
    phones: [{ value: "+49 511 1234567", evidence_ids: ["msg:1:text"] }],
    emails: [],
    relationship_indicators: [],
    product_interests: [],
    region: { value: null, evidence_ids: [], status: "uncertain" as const },
    priority: { value: null, evidence_ids: [], status: "uncertain" as const },
    facts: [],
  };
}

const baseEvidence = [
  evidence(
    "msg:1:text",
    "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567",
  ),
];

function snapshot(
  groupId: string,
  extraction: ValidatedGroupExtraction,
  evidenceItems: GroupEvidenceItem[],
): GroupExtractionVerificationSnapshot {
  return {
    groupId,
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
  };
}

describe("group extraction validation", () => {
  it("uses a closed strict transport schema", () => {
    expect(
      rawGroupExtractionSchema.safeParse({ ...baseRaw(), unknown: true }).success,
    ).toBe(false);
    expect(
      structuredGroupExtractionSchema.safeParse({
        ...baseRaw(),
        product_interests: [
          { value: "Magic Product", evidence_ids: ["msg:1:text"] },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an invented evidence ID only for the affected value", () => {
    const raw = baseRaw();
    raw.person.full_name.evidence_ids = ["msg:99:text"];

    const result = validateGroupExtraction(raw, baseEvidence);

    expect(result.candidate.person.fullName).toEqual({
      value: null,
      evidenceIds: [],
      status: "uncertain",
    });
    expect(result.candidate.phones).toHaveLength(1);
  });

  it("rejects a phone hallucination despite a valid citation", () => {
    const raw = baseRaw();
    raw.phones[0]!.value = "+49 511 9999999";

    expect(validateGroupExtraction(raw, baseEvidence).candidate.phones).toEqual([]);
  });

  it("rejects an email hallucination despite a valid citation", () => {
    const raw = baseRaw();
    raw.emails = [{ value: "invented@example.com", evidence_ids: ["msg:1:text"] }];

    expect(validateGroupExtraction(raw, baseEvidence).candidate.emails).toEqual([]);
  });

  it("preserves a suspicious .corn email exactly", () => {
    const raw = baseRaw();
    raw.emails = [{ value: "Alice@Example.corn", evidence_ids: ["msg:1:text"] }];
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; Email: Alice@Example.corn",
      ),
    ];

    expect(validateGroupExtraction(raw, source).candidate.emails[0]?.value).toBe(
      "Alice@Example.corn",
    );
  });

  it("retains multiple distinct supported phones", () => {
    const raw = baseRaw();
    raw.phones.push({ value: "+49 511 7654321", evidence_ids: ["msg:1:text"] });
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phones: +49 511 1234567 and +49 511 7654321",
      ),
    ];

    expect(validateGroupExtraction(raw, source).candidate.phones).toHaveLength(2);
  });

  it("does not treat different phones as a name conflict", () => {
    const raw = baseRaw();
    raw.phones.push({ value: "+49 511 7654321", evidence_ids: ["msg:2:text"] });
    const source = [
      baseEvidence[0]!,
      evidence("msg:2:text", "Additional phone: +49 511 7654321", "reply_text"),
    ];

    const candidate = validateGroupExtraction(raw, source).candidate;
    expect(candidate.person.fullName.status).toBe("supported");
    expect(candidate.phones).toHaveLength(2);
  });

  it("turns conflicting labeled names into null and persists conflict evidence", () => {
    const raw = baseRaw();
    raw.person.full_name.evidence_ids = ["msg:1:text", "msg:2:text"];
    raw.person.full_name.status = "conflicted";
    raw.person.full_name.value = null;
    raw.phones.push({ value: "+49 511 7654321", evidence_ids: ["msg:2:text"] });
    const source = [
      baseEvidence[0]!,
      evidence(
        "msg:2:text",
        "Name: Bob Example; Company: Example GmbH; Phone: +49 511 7654321",
        "transcript",
      ),
    ];

    const result = validateGroupExtraction(raw, source);
    expect(result.candidate.person.fullName).toEqual({
      value: null,
      evidenceIds: ["msg:1:text", "msg:2:text"],
      status: "conflicted",
    });
    expect(result.candidate.eligibility).toEqual({
      state: "not_eligible",
      reasonCode: "CONFLICTED_FULL_NAME",
    });
    expect(
      result.fieldEvidence.filter(
        (row) =>
          row.fieldName === "person.full_name" &&
          row.validationStatus === "conflicted",
      ),
    ).toHaveLength(2);
  });

  it("turns conflicting labeled companies into null and persists conflict evidence", () => {
    const raw = baseRaw();
    const source = [
      baseEvidence[0]!,
      evidence(
        "msg:2:text",
        "Name: Alice Example; Company: Different AG; Phone: +49 511 1234567",
        "reply_text",
      ),
    ];

    const result = validateGroupExtraction(raw, source);

    expect(result.candidate.person.company).toEqual({
      value: null,
      evidenceIds: ["msg:1:text", "msg:2:text"],
      status: "conflicted",
    });
    expect(
      result.fieldEvidence.filter(
        (row) => row.fieldName === "person.company" && row.validationStatus === "conflicted",
      ),
    ).toHaveLength(2);
  });

  it("derives Partner only from an explicit source keyword", () => {
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; We are a system integrator.",
      ),
    ];

    const leadType = validateGroupExtraction(baseRaw(), source).candidate.leadType;
    expect(leadType.value).toBe("Partner");
    expect(leadType.evidenceIds).toEqual(["msg:1:text"]);
  });

  it("uses Customer as the documented fallback", () => {
    expect(
      validateGroupExtraction(baseRaw(), baseEvidence).candidate.leadType,
    ).toEqual({ value: "Customer", evidenceIds: [], reason: "CUSTOMER_DEFAULT" });
  });

  it("does not infer Partner from the software industry", () => {
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; software industry",
      ),
    ];

    expect(validateGroupExtraction(baseRaw(), source).candidate.leadType.value).toBe(
      "Customer",
    );
  });

  it("does not treat a negated partner term as an indicator", () => {
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; We are not a partner.",
      ),
    ];

    expect(validateGroupExtraction(baseRaw(), source).candidate.leadType.value).toBe(
      "Customer",
    );
  });

  it.each([
    "We are not an integrator.",
    "We are the customer, not distributor.",
    "We are no longer a dealer.",
  ])("does not promote a contextually negated partner term: %s", (phrase) => {
    const source = [
      evidence(
        "msg:1:text",
        `Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; ${phrase}`,
      ),
    ];

    expect(validateGroupExtraction(baseRaw(), source).candidate.leadType.value).toBe(
      "Customer",
    );
  });

  it("grounds an explicit Customer classification in source evidence", () => {
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; We are the end user customer.",
      ),
    ];
    const result = validateGroupExtraction(baseRaw(), source);

    expect(result.candidate.leadType).toEqual({
      value: "Customer",
      evidenceIds: ["msg:1:text"],
      reason: "EXPLICIT_CUSTOMER_INDICATOR",
    });
    expect(
      result.fieldEvidence.some(
        (row) =>
          row.fieldName === "lead_type" &&
          row.evidenceRefId === "msg:1:text" &&
          row.validationStatus === "accepted",
      ),
    ).toBe(true);
  });

  it("makes contradictory explicit lead-type evidence a Customer conflict", () => {
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; We are both a customer and a distributor.",
      ),
    ];
    const result = validateGroupExtraction(baseRaw(), source);

    expect(result.candidate.leadType).toEqual({
      value: "Customer",
      evidenceIds: ["msg:1:text"],
      reason: "EXPLICIT_LEAD_TYPE_CONFLICT",
    });
    expect(
      result.fieldEvidence.some(
        (row) =>
          row.fieldName === "lead_type" &&
          row.evidenceRefId === "msg:1:text" &&
          row.validationStatus === "conflicted",
      ),
    ).toBe(true);
    expect(
      result.fieldEvidence.some(
        (row) => row.evidenceRefId === "system:customer-default",
      ),
    ).toBe(true);
  });

  it("retains only an allowed and source-supported product", () => {
    const raw = baseRaw();
    raw.product_interests = [
      { value: "Analytics", evidence_ids: ["msg:1:text"] },
    ];
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; interested in analytics",
      ),
    ];

    expect(validateGroupExtraction(raw, source).candidate.productInterests).toEqual([
      { value: "Analytics", evidenceIds: ["msg:1:text"] },
    ]);
  });

  it("omits an unsupported product without failing other fields", () => {
    const raw = baseRaw();
    raw.product_interests = [
      { value: "Magic Product", evidence_ids: ["msg:1:text"] },
    ];

    const candidate = validateGroupExtraction(raw, baseEvidence).candidate;
    expect(candidate.productInterests).toEqual([]);
    expect(candidate.phones).toHaveLength(1);
  });

  it("maps only clearly supported Europe", () => {
    const raw = baseRaw();
    raw.region = {
      value: "Europe",
      evidence_ids: ["msg:1:text"],
      status: "supported",
    };
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; based in Germany",
      ),
    ];

    expect(validateGroupExtraction(raw, source).candidate.region.value).toBe("Europe");
  });

  it("keeps an unknown region null", () => {
    const raw = baseRaw();
    raw.region = {
      value: "Atlantis",
      evidence_ids: ["msg:1:text"],
      status: "supported",
    };

    expect(validateGroupExtraction(raw, baseEvidence).candidate.region.value).toBeNull();
  });

  it("allows priority to remain null without explicit urgency", () => {
    const raw = baseRaw();
    raw.priority = {
      value: "Medium",
      evidence_ids: ["msg:1:text"],
      status: "supported",
    };

    expect(validateGroupExtraction(raw, baseEvidence).candidate.priority.value).toBeNull();
  });

  it("is eligible with reliable name and phone even without email", () => {
    const candidate = validateGroupExtraction(baseRaw(), baseEvidence).candidate;
    expect(candidate.emails).toEqual([]);
    expect(candidate.eligibility).toEqual({ state: "eligible", reasonCode: null });
  });

  it("is not eligible with name and email but no phone", () => {
    const raw = baseRaw();
    raw.phones = [];
    raw.emails = [{ value: "alice@example.com", evidence_ids: ["msg:1:text"] }];
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Email: alice@example.com",
      ),
    ];

    expect(validateGroupExtraction(raw, source).candidate.eligibility).toEqual({
      state: "not_eligible",
      reasonCode: "MISSING_PHONE",
    });
  });

  it("is not eligible with phone and company but no supported full name", () => {
    const raw = baseRaw();
    raw.person.full_name = {
      value: null,
      evidence_ids: [],
      status: "uncertain",
    };

    expect(validateGroupExtraction(raw, baseEvidence).candidate.eligibility).toEqual({
      state: "not_eligible",
      reasonCode: "MISSING_FULL_NAME",
    });
  });

  it("does not treat a single name fragment as a reliable full name", () => {
    const raw = baseRaw();
    raw.person.full_name = {
      value: "Alice",
      evidence_ids: ["msg:1:text"],
      status: "supported",
    };
    const source = [
      evidence(
        "msg:1:text",
        "Name: Alice; Company: Example GmbH; Phone: +49 511 1234567",
      ),
    ];

    const candidate = validateGroupExtraction(raw, source).candidate;
    expect(candidate.person.fullName).toEqual({
      value: null,
      evidenceIds: [],
      status: "uncertain",
    });
    expect(candidate.eligibility).toEqual({
      state: "not_eligible",
      reasonCode: "MISSING_FULL_NAME",
    });
  });

  it("protects eligibility, Customer provenance, and campaign configuration", () => {
    const customer = validateGroupExtraction(baseRaw(), baseEvidence);
    const partnerEvidence = [
      evidence(
        "msg:1:text",
        "Name: Alice Example; Company: Example GmbH; Phone: +49 511 1234567; We are a system integrator.",
      ),
    ];
    const partner = validateGroupExtraction(baseRaw(), partnerEvidence);
    const snapshots = [
      snapshot("70000000-0000-4000-8000-000000000001", customer, baseEvidence),
      snapshot(
        "70000000-0000-4000-8000-000000000002",
        partner,
        partnerEvidence,
      ),
    ];

    const checks = evaluateGroupExtractionChecks(snapshots);
    expect(checks.eligibilityRule).toBe(true);
    expect(checks.customerDefaultProvenance).toBe(true);
    expect(checks.campaignConfig).toBe(true);

    snapshots[0]!.candidate.eligibility = {
      state: "not_eligible",
      reasonCode: "MISSING_PHONE",
    };
    snapshots[0]!.fieldEvidence = snapshots[0]!.fieldEvidence.filter(
      (row) => row.evidenceRefId !== "system:customer-default",
    );
    snapshots[1]!.fieldEvidence = snapshots[1]!.fieldEvidence.filter(
      (row) => row.fieldName !== "campaign.source",
    );

    const tamperedChecks = evaluateGroupExtractionChecks(snapshots);
    expect(tamperedChecks.eligibilityRule).toBe(false);
    expect(tamperedChecks.customerDefaultProvenance).toBe(false);
    expect(tamperedChecks.campaignConfig).toBe(false);
  });
});
