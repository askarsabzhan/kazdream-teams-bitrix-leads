import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatAttachmentAcquisitionSummary } from "./format";

describe("attachment acquisition safe summary", () => {
  it("contains counters only", () => {
    const output = formatAttachmentAcquisitionSummary({
      attachmentsSeen: 5,
      claimed: 5,
      stored: 2,
      unsupported: 3,
      failed: 0,
      bytesStored: 42,
      objectsCreated: 2,
      objectsReused: 0,
    });

    expect(output).toContain("attachments_seen=5");
    expect(output).toContain("bytes_stored=42");
    expect(output).not.toMatch(/https?:|@|filename|message_body/i);
  });
});
