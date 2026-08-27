import "server-only";

import type {
  ChannelPersistenceVerification,
  IngestionSummary,
} from "./types";

function booleanText(value: boolean): string {
  return value ? "true" : "false";
}

function verificationLines(verification: ChannelPersistenceVerification) {
  return [
    "REMOTE_PERSISTENCE_VERIFICATION",
    `messages_persisted=${verification.messagesPersisted}`,
    `root_messages_persisted=${verification.rootMessagesPersisted}`,
    `replies_persisted=${verification.repliesPersisted}`,
    `messages_with_author=${verification.messagesWithAuthor}`,
    `messages_without_author=${verification.messagesWithoutAuthor}`,
    `attachments_persisted=${verification.attachmentsPersisted}`,
    `jobs_persisted=${verification.jobsPersisted}`,
    `duplicate_message_identities=${verification.duplicateMessageIdentities}`,
    `duplicate_attachment_identities=${verification.duplicateAttachmentIdentities}`,
    `duplicate_job_revisions=${verification.duplicateJobRevisions}`,
    `reply_relationships_valid=${booleanText(verification.replyRelationshipsValid)}`,
    `current_revision_jobs_complete=${booleanText(verification.currentRevisionJobsComplete)}`,
  ];
}

export function formatVerificationReport(
  verification: ChannelPersistenceVerification,
): string {
  return verificationLines(verification).join("\n");
}

export function formatIngestionReport(
  summary: IngestionSummary,
  verification?: ChannelPersistenceVerification,
): string {
  const lines = [
    "TEAMS_INGESTION_SUMMARY",
    `mode=${summary.mode}`,
    `dry_run=${booleanText(summary.dryRun)}`,
    `messages_seen=${summary.messagesSeen}`,
    `root_messages_seen=${summary.rootMessagesSeen}`,
    `replies_seen=${summary.repliesSeen}`,
    `messages_inserted=${summary.messagesInserted}`,
    `messages_updated=${summary.messagesUpdated}`,
    `messages_unchanged=${summary.messagesUnchanged}`,
    `attachments_seen=${summary.attachmentsSeen}`,
    `hosted_attachments_seen=${summary.hostedAttachmentsSeen}`,
    `reference_attachments_seen=${summary.referenceAttachmentsSeen}`,
    `attachments_inserted=${summary.attachmentsInserted}`,
    `jobs_enqueued=${summary.jobsEnqueued}`,
  ];
  if (verification) {
    lines.push("", ...verificationLines(verification));
  }
  return lines.join("\n");
}
