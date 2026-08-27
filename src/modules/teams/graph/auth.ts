import "server-only";

import { z } from "zod";

import { GraphRequestError, sanitizeRemoteDescription } from "./client";
import type { GraphAccessToken, GraphCredentials } from "./types";

const TOKEN_SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_TIMEOUT_MS = 15_000;
const EXPIRY_SKEW_MS = 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTokenResponse(
  input: unknown,
  now = Date.now(),
): GraphAccessToken {
  const parsed = tokenResponseSchema.safeParse(input);

  if (!parsed.success) {
    throw new GraphRequestError({
      endpoint: "POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      httpStatus: null,
      code: "INVALID_TOKEN_RESPONSE",
      description: "Microsoft identity platform returned an invalid token response.",
    });
  }

  return {
    accessToken: parsed.data.access_token,
    tokenType: parsed.data.token_type,
    expiresIn: parsed.data.expires_in,
    expiresAt: now + parsed.data.expires_in * 1_000,
  };
}

function oauthErrorDetails(input: unknown): {
  code: string;
  description: string;
} {
  if (!isRecord(input)) {
    return {
      code: "OAUTH_HTTP_ERROR",
      description: "Microsoft identity authentication failed.",
    };
  }

  return {
    code: typeof input.error === "string" ? input.error : "OAUTH_HTTP_ERROR",
    description:
      typeof input.error_description === "string"
        ? sanitizeRemoteDescription(input.error_description)
        : "Microsoft identity authentication failed.",
  };
}

export class ClientCredentialsTokenProvider {
  private readonly credentials: GraphCredentials;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private cachedToken: GraphAccessToken | undefined;

  constructor(
    credentials: GraphCredentials,
    options: {
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {
    this.credentials = credentials;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? TOKEN_TIMEOUT_MS;
  }

  async getToken(): Promise<GraphAccessToken> {
    if (
      this.cachedToken &&
      this.cachedToken.expiresAt - Date.now() > EXPIRY_SKEW_MS
    ) {
      return this.cachedToken;
    }

    this.cachedToken = await this.acquireToken();
    return this.cachedToken;
  }

  async getAccessToken(): Promise<string> {
    return (await this.getToken()).accessToken;
  }

  clear(): void {
    this.cachedToken = undefined;
  }

  private async acquireToken(): Promise<GraphAccessToken> {
    const endpoint = `https://login.microsoftonline.com/${encodeURIComponent(this.credentials.tenantId)}/oauth2/v2.0/token`;
    const safeEndpoint =
      "POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await this.fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          grant_type: "client_credentials",
          scope: TOKEN_SCOPE,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      throw new GraphRequestError({
        endpoint: safeEndpoint,
        httpStatus: null,
        code: isAbort ? "OAUTH_TIMEOUT" : "OAUTH_NETWORK_ERROR",
        description: isAbort
          ? "Microsoft identity authentication timed out."
          : "Microsoft identity authentication failed before an HTTP response was received.",
      });
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const details = oauthErrorDetails(body);
      throw new GraphRequestError({
        endpoint: safeEndpoint,
        httpStatus: response.status,
        code: details.code,
        description: details.description,
      });
    }

    return parseTokenResponse(body);
  }
}
