import "server-only";

import { BitrixSyncError, classifyBitrixFailure } from "./errors";

const DEFAULT_MINIMUM_INTERVAL_MS = 600;
const DEFAULT_TIMEOUT_MS = 20_000;

interface BitrixEnvelope {
  result?: unknown;
  next?: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(value: unknown): BitrixEnvelope {
  if (!isRecord(value)) {
    throw new BitrixSyncError("BITRIX_INVALID_RESPONSE", "retryable_failed");
  }
  return {
    result: value.result,
    next: typeof value.next === "number" ? value.next : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

function safeBaseUrl(value: string): URL {
  try {
    const url = new URL(value.endsWith("/") ? value : `${value}/`);
    if (
      url.protocol !== "https:" ||
      !/^\/rest\/[0-9]+\/[A-Za-z0-9_-]+\/$/u.test(url.pathname)
    ) {
      throw new Error("unsafe");
    }
    return url;
  } catch {
    throw new BitrixSyncError("BITRIX_WEBHOOK_INVALID", "permanent_failed");
  }
}

export class BitrixClient {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly minimumIntervalMs: number;
  private readonly timeoutMs: number;
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestStartedAt = 0;

  constructor(
    webhookBaseUrl: string,
    options: {
      fetchImplementation?: typeof fetch;
      minimumIntervalMs?: number;
      timeoutMs?: number;
    } = {},
  ) {
    this.baseUrl = safeBaseUrl(webhookBaseUrl);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.minimumIntervalMs = options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async call(
    method: string,
    parameters: Record<string, unknown> = {},
  ): Promise<BitrixEnvelope> {
    if (!/^[a-z][a-z0-9_.]+$/u.test(method)) {
      throw new BitrixSyncError("BITRIX_METHOD_INVALID", "permanent_failed");
    }
    const request = this.requestChain.then(() => this.execute(method, parameters));
    this.requestChain = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }

  private async execute(
    method: string,
    parameters: Record<string, unknown>,
  ): Promise<BitrixEnvelope> {
    const waitMs = Math.max(
      0,
      this.minimumIntervalMs - (Date.now() - this.lastRequestStartedAt),
    );
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestStartedAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(
        new URL(`${method}.json`, this.baseUrl),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(parameters),
          redirect: "error",
          signal: controller.signal,
        },
      );
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError"
        ? "BITRIX_TIMEOUT"
        : "BITRIX_NETWORK_ERROR";
      throw new BitrixSyncError(code, "retryable_failed");
    } finally {
      clearTimeout(timeout);
    }

    let parsed: unknown;
    try {
      parsed = (await response.json()) as unknown;
    } catch {
      throw new BitrixSyncError(
        "BITRIX_INVALID_RESPONSE",
        response.status >= 500 ? "retryable_failed" : "permanent_failed",
        response.status,
      );
    }
    const envelope = parseEnvelope(parsed);
    if (!response.ok || envelope.error) {
      throw classifyBitrixFailure({
        httpStatus: response.status,
        remoteCode: envelope.error ?? null,
      });
    }
    return envelope;
  }
}
