import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatAttachmentEvidenceSummary } from "./format";

describe("PII-safe attachment evidence summary", () => {
  it("contains metrics only", () => {
    const output = formatAttachmentEvidenceSummary({
      audioSeen: 1,
      transcribed: 1,
      imagesSeen: 2,
      ocrCompleted: 2,
      failed: 0,
      openaiRequests: 3,
      providerDurationMs: 100,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      audioDurationMs: 500,
    });

    expect(output).toContain("openai_requests=3");
    expect(output).not.toContain("PRIVATE_MARKER");
    expect(output).not.toContain("NUMERIC_MARKER");
    expect(output).not.toContain("transcript_text");
    expect(output).not.toContain("ocr_text");
  });
});
