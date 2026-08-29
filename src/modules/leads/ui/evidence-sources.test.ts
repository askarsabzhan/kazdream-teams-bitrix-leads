import { describe, expect, it } from "vitest";

import { evidenceSourceForMethod, groupEvidenceSources } from "./evidence-sources";

describe("field evidence source mapping", () => {
  it("maps only persisted supported provenance methods", () => {
    expect(
      groupEvidenceSources([
        { fieldName: "phones", method: "teams_text" },
        { fieldName: "phones", method: "ocr" },
        { fieldName: "lead_type", method: "system_default" },
        { fieldName: "emails", method: "unknown_method" },
      ]),
    ).toEqual({
      phones: ["teams", "ocr"],
      lead_type: ["businessRule"],
    });
    expect(evidenceSourceForMethod("unknown_method")).toBeNull();
  });
});
