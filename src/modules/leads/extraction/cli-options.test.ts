import { describe, expect, it } from "vitest";

import { parseGroupExtractionArguments } from "./cli-options";

describe("group extraction CLI options", () => {
  it("uses a bounded default batch", () => {
    expect(parseGroupExtractionArguments([])).toEqual({
      limit: 10,
      leaseSeconds: 300,
    });
  });

  it("rejects invalid values", () => {
    expect(() => parseGroupExtractionArguments(["--limit", "0"])).toThrow();
    expect(() => parseGroupExtractionArguments(["--unknown"])).toThrow();
  });
});
