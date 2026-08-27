import "server-only";

import OpenAI, { toFile } from "openai";

import { AttachmentEvidenceError } from "../evidence/types";
import type {
  TranscriptionProvider,
  TranscriptionProviderResult,
} from "../providers/transcription";
import { EMPTY_AI_PROVIDER_USAGE } from "../providers/usage";

import { OPENAI_PROVIDER_NAME } from "./client";
import { classifyOpenAIError } from "./errors";

export const TRANSCRIPTION_CONTRACT_VERSION = "verbatim-transcript-v1";

function extensionForMime(mimeType: string): string {
  const extensions: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
  };
  const extension = extensions[mimeType];
  if (!extension) {
    throw new AttachmentEvidenceError(
      "UNSUPPORTED_AI_MIME",
      "permanent_failed",
    );
  }
  return extension;
}

function transcriptionUsage(
  usage: { type: "tokens"; input_tokens: number; output_tokens: number; total_tokens: number } |
    { type: "duration"; seconds: number } |
    undefined,
) {
  if (!usage) return EMPTY_AI_PROVIDER_USAGE;
  if (usage.type === "tokens") {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      audioDurationMs: null,
    };
  }
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    audioDurationMs: Math.max(0, Math.round(usage.seconds * 1000)),
  };
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly providerName = OPENAI_PROVIDER_NAME;
  readonly promptVersion = TRANSCRIPTION_CONTRACT_VERSION;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {}

  async transcribe(options: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<TranscriptionProviderResult> {
    try {
      const extension = extensionForMime(options.mimeType);
      const file = await toFile(options.bytes, `source.${extension}`, {
        type: options.mimeType,
      });
      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        response_format: "json",
      });
      if (typeof transcription.text !== "string") {
        throw new AttachmentEvidenceError(
          "OPENAI_INVALID_OUTPUT",
          "permanent_failed",
        );
      }
      return {
        text: transcription.text,
        usage: transcriptionUsage(transcription.usage),
      };
    } catch (error) {
      throw classifyOpenAIError(error);
    }
  }
}
