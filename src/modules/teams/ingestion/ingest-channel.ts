import "server-only";

import { normalizeGraphMessage } from "./normalize-message";
import type {
  FetchedTeamsBatch,
  IngestionSummary,
  TeamsIngestionMode,
  TeamsMessageRepository,
} from "./types";

export async function ingestFetchedBatch(options: {
  batch: FetchedTeamsBatch;
  tenantId: string;
  mode: TeamsIngestionMode;
  dryRun: boolean;
  repository?: TeamsMessageRepository;
  observedAt?: string;
}): Promise<IngestionSummary> {
  if (!options.dryRun && !options.repository) {
    throw new Error("Teams ingestion repository is required for writes.");
  }
  const observedAt = options.observedAt ?? new Date().toISOString();
  const normalized = options.batch.messages.map((fetched) =>
    normalizeGraphMessage({
      fetched,
      tenantId: options.tenantId,
      teamId: options.batch.channel.teamId,
      channelId: options.batch.channel.channelId,
      observedAt,
    }),
  );
  const summary: IngestionSummary = {
    mode: options.mode,
    dryRun: options.dryRun,
    messagesSeen: normalized.length,
    rootMessagesSeen: options.batch.rootMessagesSeen,
    repliesSeen: options.batch.repliesSeen,
    messagesInserted: 0,
    messagesUpdated: 0,
    messagesUnchanged: 0,
    attachmentsSeen: normalized.reduce(
      (total, message) => total + message.attachments.length,
      0,
    ),
    hostedAttachmentsSeen: normalized.reduce(
      (total, message) =>
        total +
        message.attachments.filter(
          (attachment) => attachment.attachmentKind === "hosted_content",
        ).length,
      0,
    ),
    referenceAttachmentsSeen: normalized.reduce(
      (total, message) =>
        total +
        message.attachments.filter(
          (attachment) => attachment.attachmentKind === "reference",
        ).length,
      0,
    ),
    attachmentsInserted: 0,
    jobsEnqueued: 0,
  };
  if (options.dryRun) return summary;

  for (const message of normalized) {
    const outcome = await options.repository!.persistMessage(message);
    if (outcome.result === "inserted") summary.messagesInserted += 1;
    else if (outcome.result === "updated") summary.messagesUpdated += 1;
    else summary.messagesUnchanged += 1;
    summary.attachmentsInserted += outcome.attachmentsInserted;
    summary.jobsEnqueued += outcome.jobsEnqueued;
  }

  return summary;
}
