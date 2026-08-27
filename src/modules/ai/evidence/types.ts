import type { ImageTextExtractionProvider } from "../providers/image-text";
import type { AiProviderUsage } from "../providers/usage";
import type { TranscriptionProvider } from "../providers/transcription";

export type AttachmentEvidenceOperation = "transcription" | "image_text";
export type AttachmentEvidenceFailureState =
  | "retryable_failed"
  | "permanent_failed";

export interface AttachmentEvidenceClaim {
  attachmentId: string;
  leaseId: string;
  operation: AttachmentEvidenceOperation;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sourceSha256: string;
  providerName: string;
  providerModel: string;
  promptVersion: string;
  processingRevision: number;
  processingAttempts: number;
}

export interface AttachmentEvidenceClaimConfiguration {
  providerName: string;
  transcriptionModel: string;
  transcriptionVersion: string;
  imageModel: string;
  imageVersion: string;
  limit: number;
  leaseSeconds: number;
}

export interface AttachmentEvidenceCompletion {
  claim: AttachmentEvidenceClaim;
  evidenceText: string;
  documentType: "business_card" | "other" | "unknown" | null;
  durationMs: number;
  usage: AiProviderUsage;
}

export interface AttachmentEvidenceRepository {
  claim(
    configuration: AttachmentEvidenceClaimConfiguration,
  ): Promise<AttachmentEvidenceClaim[]>;
  complete(completion: AttachmentEvidenceCompletion): Promise<void>;
  recordOutcome(options: {
    claim: AttachmentEvidenceClaim;
    outcome: AttachmentEvidenceFailureState;
    errorCode: string;
    durationMs: number;
  }): Promise<void>;
}

export interface AttachmentEvidenceStorage {
  load(claim: AttachmentEvidenceClaim): Promise<Uint8Array>;
}

export interface AttachmentEvidenceSummary {
  audioSeen: number;
  transcribed: number;
  imagesSeen: number;
  ocrCompleted: number;
  failed: number;
  openaiRequests: number;
  providerDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  audioDurationMs: number;
}

export interface AttachmentEvidenceWorkerOptions {
  repository: AttachmentEvidenceRepository;
  storage: AttachmentEvidenceStorage;
  transcriptionProvider: TranscriptionProvider;
  imageProvider: ImageTextExtractionProvider;
  limit: number;
  leaseSeconds: number;
}

export class AttachmentEvidenceError extends Error {
  readonly code: string;
  readonly outcome: AttachmentEvidenceFailureState;

  constructor(code: string, outcome: AttachmentEvidenceFailureState) {
    const safeCode = /^[A-Z0-9_]{1,64}$/.test(code)
      ? code
      : "ATTACHMENT_EVIDENCE_ERROR";
    super(safeCode);
    this.name = "AttachmentEvidenceError";
    this.code = safeCode;
    this.outcome = outcome;
  }
}
