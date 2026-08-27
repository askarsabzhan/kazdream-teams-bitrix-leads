export interface AiProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  audioDurationMs: number | null;
}

export const EMPTY_AI_PROVIDER_USAGE: AiProviderUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  audioDurationMs: null,
};
