import "server-only";

import type { SafeRemoteError } from "./types";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ERROR_DESCRIPTION_LENGTH = 400;

type AccessTokenProvider = () => Promise<string>;

export class GraphRequestError extends Error {
  readonly safe: SafeRemoteError;

  constructor(safe: SafeRemoteError) {
    super(`${safe.code}: ${safe.description}`);
    this.name = "GraphRequestError";
    this.safe = safe;
  }
}

export function sanitizeDiagnosticText(
  input: string,
  sensitiveValues: readonly string[] = [],
): string {
  let sanitized = input;

  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length > 0) {
      sanitized = sanitized.split(sensitiveValue).join("[REDACTED]");
    }
  }

  return sanitized
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(access_token|client_secret|refresh_token|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
      "[REDACTED_TOKEN]",
    )
    .replace(
      /(?<![:A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[REDACTED_EMAIL]",
    )
    .replace(/[\r\t]+/g, " ")
    .replace(/ {2,}/g, " ");
}

export function sanitizeRemoteDescription(input: string): string {
  return sanitizeDiagnosticText(input)
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[REDACTED_ID]",
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_ERROR_DESCRIPTION_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphErrorDetails(value: unknown): {
  code: string;
  description: string;
} {
  if (!isRecord(value) || !isRecord(value.error)) {
    return {
      code: "GRAPH_HTTP_ERROR",
      description: "Microsoft Graph request failed.",
    };
  }

  return {
    code:
      typeof value.error.code === "string"
        ? value.error.code
        : "GRAPH_HTTP_ERROR",
    description:
      typeof value.error.message === "string"
        ? sanitizeRemoteDescription(value.error.message)
        : "Microsoft Graph request failed.",
  };
}

function createLocalGraphError(
  endpoint: string,
  code: string,
  description: string,
): GraphRequestError {
  return new GraphRequestError({
    endpoint,
    httpStatus: null,
    code,
    description: sanitizeRemoteDescription(description),
  });
}

async function fetchWithTimeout(
  fetchImplementation: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export class GraphClient {
  private readonly accessTokenProvider: AccessTokenProvider;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    accessTokenProvider: AccessTokenProvider,
    options: {
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {
    this.accessTokenProvider = accessTokenProvider;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getJson(endpoint: string, safeEndpoint: string): Promise<unknown> {
    const response = await this.get(endpoint, safeEndpoint);

    try {
      return (await response.json()) as unknown;
    } catch {
      throw createLocalGraphError(
        safeEndpoint,
        "INVALID_JSON_RESPONSE",
        "Microsoft Graph returned a non-JSON response.",
      );
    }
  }

  async getByteMetadata(
    endpoint: string,
    safeEndpoint: string,
  ): Promise<{ contentType: string; byteLength: number }> {
    const response = await this.get(endpoint, safeEndpoint);
    const bytes = await response.arrayBuffer();

    return {
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
        "unknown",
      byteLength: bytes.byteLength,
    };
  }

  async getBoundedBytes(
    endpoint: string,
    safeEndpoint: string,
    maximumBytes: number,
  ): Promise<{ contentType: string; bytes: Uint8Array }> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw createLocalGraphError(
        safeEndpoint,
        "INVALID_BYTE_LIMIT",
        "The Graph byte limit is invalid.",
      );
    }

    const response = await this.get(endpoint, safeEndpoint);
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength =
      contentLengthHeader !== null && /^\d+$/.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : null;
    if (contentLength !== null && contentLength > maximumBytes) {
      await response.body?.cancel();
      throw createLocalGraphError(
        safeEndpoint,
        "FILE_TOO_LARGE",
        "The Graph response exceeds the configured byte limit.",
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        contentType:
          response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
          "unknown",
        bytes: new Uint8Array(),
      };
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        byteLength += chunk.value.byteLength;
        if (byteLength > maximumBytes) {
          await reader.cancel();
          throw createLocalGraphError(
            safeEndpoint,
            "FILE_TOO_LARGE",
            "The Graph response exceeds the configured byte limit.",
          );
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof GraphRequestError) throw error;
      throw createLocalGraphError(
        safeEndpoint,
        "GRAPH_BODY_READ_FAILED",
        "The Graph response body could not be read.",
      );
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
        "unknown",
      bytes,
    };
  }

  private async get(endpoint: string, safeEndpoint: string): Promise<Response> {
    const accessToken = await this.accessTokenProvider();
    const url = this.resolveGraphUrl(endpoint, safeEndpoint);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.fetchImplementation,
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          redirect: "follow",
        },
        this.timeoutMs,
      );
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      throw createLocalGraphError(
        safeEndpoint,
        isAbort ? "GRAPH_TIMEOUT" : "GRAPH_NETWORK_ERROR",
        isAbort
          ? "Microsoft Graph request timed out."
          : "Microsoft Graph request failed before an HTTP response was received.",
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        try {
          errorBody = (await response.json()) as unknown;
        } catch {
          errorBody = undefined;
        }
      }

      const details = graphErrorDetails(errorBody);
      throw new GraphRequestError({
        endpoint: safeEndpoint,
        httpStatus: response.status,
        code: details.code,
        description: details.description,
      });
    }

    return response;
  }

  private resolveGraphUrl(endpoint: string, safeEndpoint: string): string {
    if (endpoint.startsWith("/")) {
      return `${GRAPH_BASE_URL}${endpoint}`;
    }

    try {
      const url = new URL(endpoint);
      if (url.origin !== "https://graph.microsoft.com") {
        throw new Error("Unexpected Graph pagination origin.");
      }
      return url.toString();
    } catch {
      throw createLocalGraphError(
        safeEndpoint,
        "INVALID_GRAPH_URL",
        "Microsoft Graph returned an invalid pagination URL.",
      );
    }
  }
}
