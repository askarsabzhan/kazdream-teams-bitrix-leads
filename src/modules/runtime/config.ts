import { z } from "zod";

export const DEFAULT_WORKER_POLL_INTERVAL_MS = 10_000;

const pollIntervalSchema = z.coerce.number().int().min(5_000).max(15_000);

export type WorkerRuntimeConfiguration = {
  pollIntervalMs: number;
};

export function readWorkerRuntimeConfiguration(
  source: Record<string, string | undefined> = process.env,
): WorkerRuntimeConfiguration {
  return {
    pollIntervalMs: pollIntervalSchema.parse(
      source.WORKER_POLL_INTERVAL_MS ?? DEFAULT_WORKER_POLL_INTERVAL_MS,
    ),
  };
}

export const WORKER_BATCH_LIMITS = {
  teamsMessages: 50,
  attachmentAcquisition: 5,
  attachmentEvidence: 5,
  conversationGrouping: 100,
  groupExtraction: 10,
  canonicalGroups: 25,
  canonicalSummaries: 10,
  crmOutbox: 10,
} as const;

export const WORKER_LEASE_SECONDS = 300;
