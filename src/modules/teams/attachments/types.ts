export type AttachmentAcquisitionFailureState =
  | "unsupported"
  | "retryable_failed"
  | "permanent_failed";

export interface AttachmentAcquisitionClaim {
  attachmentId: string;
  teamsMessageId: string;
  leaseId: string;
  tenantId: string;
  teamId: string;
  channelId: string;
  externalMessageId: string;
  rootExternalMessageId: string | null;
  attachmentKind: "hosted_content" | "reference";
  sourceLocator: Record<string, string>;
  declaredMimeType: string | null;
  sourceSizeBytes: number | null;
  fetchAttempts: number;
}

export interface DownloadedAttachment {
  bytes: Uint8Array;
  declaredMimeType: string | null;
}

export interface ValidatedAttachment {
  bytes: Uint8Array;
  byteLength: number;
  mimeType: string;
  sha256: string;
}

export interface AttachmentAcquisitionRepository {
  claim(options: {
    limit: number;
    leaseSeconds: number;
  }): Promise<AttachmentAcquisitionClaim[]>;
  complete(options: {
    claim: AttachmentAcquisitionClaim;
    storagePath: string;
    validated: ValidatedAttachment;
  }): Promise<void>;
  recordOutcome(options: {
    claim: AttachmentAcquisitionClaim;
    outcome: AttachmentAcquisitionFailureState;
    errorCode: string;
  }): Promise<void>;
}

export interface AttachmentByteSource {
  download(claim: AttachmentAcquisitionClaim): Promise<DownloadedAttachment>;
}

export interface AttachmentObjectStorage {
  store(options: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<{ alreadyExisted: boolean }>;
}

export interface AttachmentAcquisitionSummary {
  attachmentsSeen: number;
  claimed: number;
  stored: number;
  unsupported: number;
  failed: number;
  bytesStored: number;
  objectsCreated: number;
  objectsReused: number;
}

export class AttachmentAcquisitionError extends Error {
  readonly code: string;
  readonly outcome: AttachmentAcquisitionFailureState;

  constructor(code: string, outcome: AttachmentAcquisitionFailureState) {
    super(code);
    this.name = "AttachmentAcquisitionError";
    this.code = /^[A-Z0-9_]{1,64}$/.test(code)
      ? code
      : "ATTACHMENT_ACQUISITION_ERROR";
    this.outcome = outcome;
  }
}
