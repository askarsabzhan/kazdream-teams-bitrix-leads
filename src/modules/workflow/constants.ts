export const JOB_STATES = [
  "pending",
  "processing",
  "succeeded",
  "retryable_failed",
  "permanent_failed",
] as const;

export type JobState = (typeof JOB_STATES)[number];
