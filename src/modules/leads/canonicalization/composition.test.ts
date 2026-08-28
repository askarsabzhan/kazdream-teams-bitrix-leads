import { describe, expect, it } from "vitest";

import type { GroupCandidatePayload } from "../extraction/types";

import {
  candidateIdentityKeys,
  candidateSecondaryKeys,
  composeCanonicalLead,
  resolveCanonicalMatch,
  type ExistingCanonicalIdentity,
} from "./composition";
import type { EligibleCanonicalGroup } from "./types";

function candidate(overrides: Partial<GroupCandidatePayload> = {}): GroupCandidatePayload {
  return {
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
    ...overrides,
  };
}

function group(
  suffix: string,
  candidateValue: GroupCandidatePayload = candidate(),
  author = `manager-${suffix}`,
  time = `2026-08-28T10:00:0${suffix}Z`,
): EligibleCanonicalGroup {
  return {
    groupId: `71000000-0000-4000-8000-00000000000${suffix}`,
    leadId: null,
    candidateSourceFingerprint: suffix.repeat(64),
    candidate: candidateValue,
    contributors: [
      {
        teamsMessageId: `72000000-0000-4000-8000-00000000000${suffix}`,
        authorTeamsUserId: author,
        sourceCreatedAt: time,
      },
    ],
  };
}

function existing(
  leadId: string,
  source: EligibleCanonicalGroup,
): ExistingCanonicalIdentity {
  const secondary = candidateSecondaryKeys(source);
  return {
    leadId,
    identityKeys: candidateIdentityKeys(source),
    nameKey: secondary.nameKey,
    companyKey: secondary.companyKey,
  };
}

describe("canonical lead resolution", () => {
  it("matches an exact normalized phone across managers", () => {
    const first = group("1");
    const second = group(
      "2",
      candidate({
        phones: [{ value: "+49 (511) 100-0001", evidenceIds: ["msg:1:text"] }],
      }),
    );

    expect(resolveCanonicalMatch(second, [existing("lead-a", first)])).toEqual({
      state: "match",
      leadId: "lead-a",
    });
  });

  it("matches an exact lowercase email without repairing its domain", () => {
    const first = group(
      "1",
      candidate({ emails: [{ value: "Person@Example.corn", evidenceIds: ["msg:1:text"] }] }),
    );
    const second = group(
      "2",
      candidate({ emails: [{ value: "person@example.corn", evidenceIds: ["msg:1:text"] }] }),
    );

    expect(resolveCanonicalMatch(second, [existing("lead-a", first)]).leadId).toBe(
      "lead-a",
    );
  });

  it("uses exact normalized full name plus company as a secondary match", () => {
    const first = group("1");
    const second = group(
      "2",
      candidate({
        phones: [{ value: "+49 511 2000002", evidenceIds: ["msg:1:text"] }],
      }),
    );

    expect(resolveCanonicalMatch(second, [existing("lead-a", first)]).leadId).toBe(
      "lead-a",
    );
  });

  it("does not fuzzy-merge a similar name", () => {
    const first = group("1");
    const second = group(
      "2",
      candidate({
        person: {
          ...candidate().person,
          fullName: {
            value: "Synthetic Persons",
            evidenceIds: ["msg:1:text"],
            status: "supported",
          },
        },
        phones: [{ value: "+49 511 2000002", evidenceIds: ["msg:1:text"] }],
      }),
    );

    expect(resolveCanonicalMatch(second, [existing("lead-a", first)])).toEqual({
      state: "create",
      leadId: null,
    });
  });

  it("does not merge when phone and email resolve to different leads", () => {
    const phoneGroup = group("1");
    const emailGroup = group(
      "2",
      candidate({
        phones: [{ value: "+49 511 2000002", evidenceIds: ["msg:1:text"] }],
        emails: [{ value: "person@example.test", evidenceIds: ["msg:1:text"] }],
      }),
    );
    const collision = group(
      "3",
      candidate({
        phones: phoneGroup.candidate.phones,
        emails: emailGroup.candidate.emails,
      }),
    );

    expect(
      resolveCanonicalMatch(collision, [
        existing("lead-phone", phoneGroup),
        existing("lead-email", emailGroup),
      ]),
    ).toEqual({ state: "identity_conflict", leadId: null });
  });

  it("preserves multiple reliable phones during enrichment", () => {
    const first = group("1");
    const second = group(
      "2",
      candidate({
        phones: [{ value: "+49 511 2000002", evidenceIds: ["msg:1:text"] }],
      }),
    );

    expect(composeCanonicalLead([first, second]).payload.phones).toHaveLength(2);
  });

  it("makes conflicting names null instead of silently switching", () => {
    const first = group("1");
    const second = group(
      "2",
      candidate({
        person: {
          ...candidate().person,
          fullName: {
            value: "Different Person",
            evidenceIds: ["msg:1:text"],
            status: "supported",
          },
        },
      }),
    );

    expect(composeCanonicalLead([first, second]).payload.person.fullName).toEqual({
      value: null,
      status: "conflicted",
      groupIds: [first.groupId, second.groupId],
    });
  });

  it("does not let Customer default override explicit Partner", () => {
    const customer = group("1");
    const partner = group(
      "2",
      candidate({
        leadType: {
          value: "Partner",
          evidenceIds: ["msg:1:text"],
          reason: "EXPLICIT_PARTNER_INDICATOR",
        },
      }),
    );

    expect(composeCanonicalLead([customer, partner]).payload.leadType).toEqual({
      value: "Partner",
      status: "supported",
      groupIds: [partner.groupId],
    });
  });
});
