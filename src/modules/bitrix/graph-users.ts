import "server-only";

import { ClientCredentialsTokenProvider } from "../teams/graph/auth";
import { GraphClient, GraphRequestError } from "../teams/graph/client";
import type { GraphCredentials } from "../teams/graph/types";

import { BitrixSyncError } from "./errors";
import type { TeamsManagerDirectory } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function corporateEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("und");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : null;
}

export class GraphManagerDirectory implements TeamsManagerDirectory {
  private readonly client: GraphClient;

  constructor(
    credentials: GraphCredentials,
    options: { fetchImplementation?: typeof fetch } = {},
  ) {
    const tokenProvider = new ClientCredentialsTokenProvider(credentials, options);
    this.client = new GraphClient(() => tokenProvider.getAccessToken(), options);
  }

  async resolveEmails(teamsUserId: string): Promise<string[]> {
    const query = new URLSearchParams({ $select: "id,mail,userPrincipalName" });
    try {
      const value = await this.client.getJson(
        `/users/${encodeURIComponent(teamsUserId)}?${query.toString()}`,
        "GET /users/{teams-user-id}",
      );
      if (!isRecord(value)) {
        throw new BitrixSyncError("GRAPH_MANAGER_INVALID", "blocked");
      }
      const emails = new Set<string>();
      const mail = corporateEmail(value.mail);
      const principalName = corporateEmail(value.userPrincipalName);
      if (mail) emails.add(mail);
      if (principalName) emails.add(principalName);
      return [...emails];
    } catch (error) {
      if (error instanceof BitrixSyncError) throw error;
      if (error instanceof GraphRequestError) {
        const retryable = error.safe.httpStatus === null ||
          error.safe.httpStatus === 429 ||
          (error.safe.httpStatus !== null && error.safe.httpStatus >= 500);
        throw new BitrixSyncError(
          retryable ? "GRAPH_MANAGER_TRANSIENT" : "GRAPH_MANAGER_UNAVAILABLE",
          retryable ? "retryable_failed" : "blocked",
          error.safe.httpStatus,
        );
      }
      throw new BitrixSyncError("GRAPH_MANAGER_TRANSIENT", "retryable_failed");
    }
  }
}
