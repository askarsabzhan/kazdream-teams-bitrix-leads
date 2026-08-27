import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OpenAITranscriptionProvider } from "./transcription";

function providerReturning(text: string) {
  const create = vi.fn(async () => ({
    text,
    usage: {
      type: "tokens" as const,
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
    },
  }));
  return {
    create,
    provider: new OpenAITranscriptionProvider(
      { audio: { transcriptions: { create } } } as never,
      "gpt-4o-mini-transcribe",
    ),
  };
}

describe("OpenAI transcription provider", () => {
  it("preserves the provider transcript exactly", async () => {
    const exact = "  Call me at 555-0100... domain.corn\n";
    const { provider } = providerReturning(exact);

    const result = await provider.transcribe({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
    });

    expect(result.text).toBe(exact);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
      audioDurationMs: null,
    });
  });

  it("preserves mixed-language transcription without translation", async () => {
    const exact = "Сәлем, hello — встреча ертең.";
    const { create, provider } = providerReturning(exact);

    await expect(
      provider.transcribe({
        bytes: new Uint8Array([4, 5, 6]),
        mimeType: "audio/mpeg",
      }),
    ).resolves.toMatchObject({ text: exact });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini-transcribe",
        response_format: "json",
      }),
    );
  });
});
