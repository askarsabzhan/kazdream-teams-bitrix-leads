import "server-only";

import type { AttachmentEvidenceSummary } from "./types";

export function formatAttachmentEvidenceSummary(
  summary: AttachmentEvidenceSummary,
): string {
  return [
    "ATTACHMENT_AI_EVIDENCE_SUMMARY",
    `audio_seen=${summary.audioSeen}`,
    `transcribed=${summary.transcribed}`,
    `images_seen=${summary.imagesSeen}`,
    `ocr_completed=${summary.ocrCompleted}`,
    `failed=${summary.failed}`,
    `openai_requests=${summary.openaiRequests}`,
    `provider_duration_ms=${summary.providerDurationMs}`,
    `input_tokens=${summary.inputTokens}`,
    `output_tokens=${summary.outputTokens}`,
    `total_tokens=${summary.totalTokens}`,
    `audio_duration_ms=${summary.audioDurationMs}`,
  ].join("\n");
}
