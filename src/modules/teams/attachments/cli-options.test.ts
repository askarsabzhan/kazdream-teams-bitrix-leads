import { describe, expect, it } from "vitest";

import { parseAttachmentAcquireArguments } from "./cli-options";

describe("attachments:acquire CLI options", () => {
  it("uses a small bounded batch and a five-minute lease by default", () => {
    expect(parseAttachmentAcquireArguments([])).toEqual({
      limit: 5,
      leaseSeconds: 300,
    });
  });

  it("accepts bounded explicit values", () => {
    expect(
      parseAttachmentAcquireArguments(["--limit=10", "--lease-seconds=600"]),
    ).toEqual({ limit: 10, leaseSeconds: 600 });
  });

  it("rejects unbounded or unknown arguments", () => {
    expect(() => parseAttachmentAcquireArguments(["--limit=26"])).toThrow();
    expect(() =>
      parseAttachmentAcquireArguments(["--lease-seconds=10"]),
    ).toThrow();
    expect(() => parseAttachmentAcquireArguments(["--verbose"])).toThrow();
  });
});
