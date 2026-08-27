import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { imageTextEvidenceSchema } from "../providers/image-text";

import {
  IMAGE_TEXT_EXTRACTION_PROMPT,
  OpenAIImageTextExtractionProvider,
} from "./vision";

function imageProviderReturning(outputParsed: unknown) {
  const parse = vi.fn(async () => ({
    output_parsed: outputParsed,
    usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
  }));
  return {
    parse,
    provider: new OpenAIImageTextExtractionProvider(
      { responses: { parse } } as never,
      "gpt-4o-mini",
    ),
  };
}

describe("OpenAI image visible-text provider", () => {
  it("returns the strict visible-text result and preserves suspicious email", async () => {
    const visibleText = "VISIBLE_TEXT_FIXTURE";
    const { parse, provider } = imageProviderReturning({
      document_type: "business_card",
      visible_text: visibleText,
    });

    const result = await provider.extractVisibleText({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });

    expect(result.visible_text).toBe(visibleText);
    expect(result.document_type).toBe("business_card");
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        store: false,
        instructions: IMAGE_TEXT_EXTRACTION_PROMPT,
      }),
    );
  });

  it("rejects invalid structured output", async () => {
    const { provider } = imageProviderReturning({
      document_type: "business_card",
    });

    await expect(
      provider.extractVisibleText({
        bytes: new Uint8Array([1]),
        mimeType: "image/png",
      }),
    ).rejects.toMatchObject({
      code: "OPENAI_INVALID_OUTPUT",
      outcome: "permanent_failed",
    });
  });

  it("keeps the schema limited to evidence instead of lead extraction", () => {
    expect(
      imageTextEvidenceSchema.safeParse({
        document_type: "business_card",
        visible_text: "visible",
        lead_type: "Partner",
      }).success,
    ).toBe(false);
    expect(IMAGE_TEXT_EXTRACTION_PROMPT).toContain("Do not correct");
    expect(IMAGE_TEXT_EXTRACTION_PROMPT).toContain("Do not invent");
    expect(IMAGE_TEXT_EXTRACTION_PROMPT).toContain("Do not translate");
  });
});
