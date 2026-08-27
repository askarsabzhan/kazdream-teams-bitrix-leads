import { describe, expect, it } from "vitest";

import { parseAttachmentEvidenceArguments } from "./cli-options";

describe("ai:evidence CLI options", () => {
  it("uses a bounded default batch", () => {
    expect(parseAttachmentEvidenceArguments([])).toEqual({
      limit: 5,
      leaseSeconds: 300,
    });
  });

  it("rejects an unbounded limit", () => {
    expect(() => parseAttachmentEvidenceArguments(["--limit=26"])).toThrow(
      "Invalid ai:evidence arguments.",
    );
  });
});
