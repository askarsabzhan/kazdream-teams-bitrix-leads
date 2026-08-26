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
