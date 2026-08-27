import "server-only";

import OpenAI from "openai";

import { AttachmentEvidenceError } from "../evidence/types";

function numericStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  return typeof error.name === "string" ? error.name : undefined;
}

export function classifyOpenAIError(error: unknown): AttachmentEvidenceError {
  if (error instanceof AttachmentEvidenceError) return error;

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    errorName(error) === "APIConnectionTimeoutError"
  ) {
    return new AttachmentEvidenceError("OPENAI_TIMEOUT", "retryable_failed");
  }
  if (
    error instanceof OpenAI.APIConnectionError ||
    errorName(error) === "APIConnectionError"
  ) {
    return new AttachmentEvidenceError(
      "OPENAI_CONNECTION_ERROR",
      "retryable_failed",
    );
  }

  const status = numericStatus(error);
  if (status === 429) {
    return new AttachmentEvidenceError(
      "OPENAI_RATE_LIMITED",
      "retryable_failed",
    );
  }
  if (status === 408 || status === 409 || (status !== undefined && status >= 500)) {
    return new AttachmentEvidenceError(
      status !== undefined && status >= 500
        ? "OPENAI_SERVER_ERROR"
        : "OPENAI_TRANSIENT_ERROR",
      "retryable_failed",
    );
  }
  if (status === 401 || status === 403) {
    return new AttachmentEvidenceError(
      "OPENAI_AUTHORIZATION_ERROR",
      "permanent_failed",
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AttachmentEvidenceError(
      "OPENAI_INVALID_REQUEST",
      "permanent_failed",
    );
  }

  return new AttachmentEvidenceError(
    "OPENAI_PROVIDER_ERROR",
    "retryable_failed",
  );
}
