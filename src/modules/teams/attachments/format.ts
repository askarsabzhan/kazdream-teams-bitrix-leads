import "server-only";

import type { AttachmentAcquisitionSummary } from "./types";

export function formatAttachmentAcquisitionSummary(
  summary: AttachmentAcquisitionSummary,
): string {
  return [
    "TEAMS_ATTACHMENT_ACQUISITION_SUMMARY",
    `attachments_seen=${summary.attachmentsSeen}`,
    `claimed=${summary.claimed}`,
    `stored=${summary.stored}`,
    `unsupported=${summary.unsupported}`,
    `failed=${summary.failed}`,
    `bytes_stored=${summary.bytesStored}`,
    `objects_created=${summary.objectsCreated}`,
    `objects_reused=${summary.objectsReused}`,
  ].join("\n");
}
