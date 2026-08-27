import { z } from "zod";

import type { AiProviderUsage } from "./usage";

export const imageTextEvidenceSchema = z
  .object({
    document_type: z.enum(["business_card", "other", "unknown"]),
    visible_text: z.string(),
  })
  .strict();

export type ImageTextEvidence = z.infer<typeof imageTextEvidenceSchema>;

export interface ImageTextExtractionProviderResult
  extends ImageTextEvidence {
  usage: AiProviderUsage;
}

export interface ImageTextExtractionProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  extractVisibleText(options: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<ImageTextExtractionProviderResult>;
}
