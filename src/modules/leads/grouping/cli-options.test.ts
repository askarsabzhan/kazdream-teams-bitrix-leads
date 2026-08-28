import { describe, expect, it } from "vitest";

import {
  ConversationGroupingCliOptionsError,
  parseConversationGroupingArguments,
} from "./cli-options";

describe("conversation grouping CLI options", () => {
  it("uses a bounded default", () => {
    expect(parseConversationGroupingArguments([])).toEqual({ limit: 100 });
  });

  it("accepts a bounded limit", () => {
    expect(parseConversationGroupingArguments(["--limit=9"])).toEqual({
      limit: 9,
    });
  });

  it("rejects unknown or unbounded arguments", () => {
    expect(() => parseConversationGroupingArguments(["--limit=0"])).toThrow(
      ConversationGroupingCliOptionsError,
    );
    expect(() => parseConversationGroupingArguments(["--unsafe"])).toThrow(
      ConversationGroupingCliOptionsError,
    );
  });
});
