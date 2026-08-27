import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyOpenAIError } from "./errors";

describe("OpenAI safe error classification", () => {
  it.each([
    [{ name: "APIConnectionTimeoutError" }, "OPENAI_TIMEOUT"],
    [{ status: 429 }, "OPENAI_RATE_LIMITED"],
    [{ status: 500 }, "OPENAI_SERVER_ERROR"],
    [{ status: 503 }, "OPENAI_SERVER_ERROR"],
  ])("classifies retryable failures", (error, code) => {
    expect(classifyOpenAIError(error)).toMatchObject({
      code,
      outcome: "retryable_failed",
    });
  });

  it("classifies source-caused invalid requests as permanent", () => {
    expect(classifyOpenAIError({ status: 400 })).toMatchObject({
      code: "OPENAI_INVALID_REQUEST",
      outcome: "permanent_failed",
    });
  });
});
