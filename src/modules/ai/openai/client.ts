import "server-only";

import OpenAI from "openai";

export const OPENAI_PROVIDER_NAME = "openai";
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL =
  "gpt-4o-mini-transcribe";
export const DEFAULT_OPENAI_VISION_MODEL = "gpt-4o-mini";
export const OPENAI_TIMEOUT_MS = 60_000;

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: OPENAI_TIMEOUT_MS,
  });
}
