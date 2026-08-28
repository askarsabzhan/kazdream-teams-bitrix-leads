import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatConversationGroupingSummary } from "./format";

describe("conversation grouping safe summary", () => {
  it("contains only counts and protected pass/fail values", () => {
    const output = formatConversationGroupingSummary({
      messagesConsidered: 9,
      groupsCreated: 3,
      membershipsCreated: 6,
      membershipsRemoved: 0,
      revisionsCreated: 3,
      ambiguous: 3,
      deferred: 0,
      unchanged: 0,
      openaiRequests: 0,
      checks: {
        rootReply: true,
        photoAudio: true,
        distinctContactsNotMerged: true,
      },
    });
    expect(output).toContain("openai_requests=0");
    expect(output).toContain("ROOT_REPLY_GROUP_CHECK=PASS");
    expect(output).not.toContain("body_content");
    expect(output).not.toContain("transcript_text");
    expect(output).not.toContain("ocr_text");
  });
});
