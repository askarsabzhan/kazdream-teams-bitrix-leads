export type BitrixFailureOutcome =
  | "retryable_failed"
  | "permanent_failed"
  | "blocked";

export class BitrixSyncError extends Error {
  readonly code: string;
  readonly outcome: BitrixFailureOutcome;
  readonly httpStatus: number | null;

  constructor(
    code: string,
    outcome: BitrixFailureOutcome,
    httpStatus: number | null = null,
  ) {
    const safeCode = /^[A-Z0-9_]{1,64}$/u.test(code)
      ? code
      : "BITRIX_SYNC_ERROR";
    super(safeCode);
    this.name = "BitrixSyncError";
    this.code = safeCode;
    this.outcome = outcome;
    this.httpStatus = httpStatus;
  }
}

export function classifyBitrixFailure(options: {
  httpStatus: number | null;
  remoteCode: string | null;
}): BitrixSyncError {
  const remoteCode = options.remoteCode?.toUpperCase() ?? null;
  if (
    options.httpStatus === 429 ||
    options.httpStatus === 503 ||
    (options.httpStatus !== null && options.httpStatus >= 500) ||
    remoteCode === "QUERY_LIMIT_EXCEEDED" ||
    remoteCode === "OPERATION_TIME_LIMIT"
  ) {
    return new BitrixSyncError("BITRIX_RATE_OR_TRANSIENT", "retryable_failed", options.httpStatus);
  }
  if (remoteCode === "INVALID_CREDENTIALS" || options.httpStatus === 401 || options.httpStatus === 403) {
    return new BitrixSyncError("BITRIX_AUTH_FAILED", "permanent_failed", options.httpStatus);
  }
  return new BitrixSyncError("BITRIX_REQUEST_REJECTED", "permanent_failed", options.httpStatus);
}
