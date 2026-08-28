import { describe, expect, it } from "vitest";

import { buildGroupExtractionIdentity } from "./identity";
import type { GroupEvidenceItem } from "./types";

const evidenceItems: GroupEvidenceItem[] = [
  {
    id: "msg:1:text",
    type: "teams_text",
    teamsMessageId: "40000000-0000-4000-8000-000000000001",
    attachmentId: null,
    text: "synthetic source",
  },
];

function identity(overrides: Partial<Parameters<typeof buildGroupExtractionIdentity>[0]> = {}) {
  return buildGroupExtractionIdentity({
    groupId: "42000000-0000-4000-8000-000000000001",
    groupingRevision: 1,
    groupingAlgorithmVersion: "v1",
    evidenceItems,
    providerName: "openai",
    providerModel: "gpt-4o-mini",
    promptVersion: "group-candidate-v1",
    schemaVersion: "group-candidate-schema-v1",
    ...overrides,
  });
}

describe("group extraction identity", () => {
  it("is deterministic for the same ordered source identity", () => {
    expect(identity()).toBe(identity());
  });

  it("changes for group, evidence, model, prompt, or schema revisions", () => {
    const baseline = identity();
    expect(identity({ groupingRevision: 2 })).not.toBe(baseline);
    expect(identity({ evidenceItems: [{ ...evidenceItems[0]!, text: "changed" }] })).not.toBe(
      baseline,
    );
    expect(identity({ providerModel: "gpt-4o-mini-next" })).not.toBe(baseline);
    expect(identity({ promptVersion: "group-candidate-v2" })).not.toBe(baseline);
    expect(identity({ schemaVersion: "group-candidate-schema-v2" })).not.toBe(
      baseline,
    );
  });
});
