import type { AiProviderUsage } from "./usage";

export interface TranscriptionProviderResult {
  text: string;
  usage: AiProviderUsage;
}

export interface TranscriptionProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  transcribe(options: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<TranscriptionProviderResult>;
}
