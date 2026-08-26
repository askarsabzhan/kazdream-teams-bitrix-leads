export const CRM_STATES = [
  "pending",
  "processing",
  "succeeded",
  "retryable_failed",
  "permanent_failed",
] as const;

export const CRM_OUTBOX_STATES = [
  "pending",
  "processing",
  "succeeded",
  "retryable_failed",
  "reconciling",
  "permanent_failed",
] as const;

export type CrmState = (typeof CRM_STATES)[number];
export type CrmOutboxState = (typeof CRM_OUTBOX_STATES)[number];
