export const MESSAGE_STATES = [
  "received",
  "waiting_attachment",
  "ready",
  "processing",
  "processed",
  "ignored",
  "retryable_failed",
  "permanent_failed",
] as const;

export type MessageState = (typeof MESSAGE_STATES)[number];

export const TEAMS_MESSAGE_SOURCE = "microsoft_teams" as const;
export const TEAMS_MESSAGE_JOB_TYPE = "process_teams_message" as const;
export const TEAMS_ATTACHMENT_KINDS = [
  "hosted_content",
  "reference",
] as const;
