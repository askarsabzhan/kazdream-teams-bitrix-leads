import "server-only";

import { ClientCredentialsTokenProvider } from "./auth";
import { GraphClient, GraphRequestError } from "./client";
import { collectPaginated, parseCollectionPage } from "./pagination";
import type { GraphCredentials } from "./types";
import type {
  FetchedGraphMessage,
  FetchedTeamsBatch,
  ResolvedTeamsChannel,
} from "../ingestion/types";

const TEAM_ENDPOINT = "GET /teams (bounded exact-name filter)";
const CHANNEL_ENDPOINT = "GET /teams/{team-id}/channels";
const MESSAGES_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages";
const REPLIES_ENDPOINT =
  "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies";
const HISTORY_ENDPOINT =
  "GET /teams/{team-id}/channels/getAllMessages (bounded date filter)";

interface NamedGraphResource {
  id: string;
  displayName: string;
  membershipType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function odataString(value: string): string {
  return value.replaceAll("'", "''");
}

function parseNamedResource(value: unknown): NamedGraphResource | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const displayName = nonEmptyString(value.displayName);
  const membershipType = nonEmptyString(value.membershipType);
  if (!id || !displayName) return undefined;
  return {
    id,
    displayName,
    ...(membershipType ? { membershipType } : {}),
  };
}

function parseMessage(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) && nonEmptyString(value.id) ? value : undefined;
}

function exactResource(
  resources: readonly NamedGraphResource[],
  name: string,
  endpoint: string,
  code: string,
): NamedGraphResource {
  const matches = resources.filter((resource) => resource.displayName === name);
  if (matches.length !== 1) {
    throw new GraphRequestError({
      endpoint,
      httpStatus: null,
      code,
      description: `Expected one exact configured-name match; found ${matches.length}.`,
    });
  }
  return matches[0];
}

export class GraphTeamsReader {
  private readonly client: GraphClient;

  constructor(
    credentials: GraphCredentials,
    options: { fetchImplementation?: typeof fetch } = {},
  ) {
    const tokenProvider = new ClientCredentialsTokenProvider(credentials, {
      ...(options.fetchImplementation
        ? { fetchImplementation: options.fetchImplementation }
        : {}),
    });
    this.client = new GraphClient(() => tokenProvider.getAccessToken(), {
      ...(options.fetchImplementation
        ? { fetchImplementation: options.fetchImplementation }
        : {}),
    });
  }

  async resolveChannel(
    teamName: string,
    channelName: string,
  ): Promise<ResolvedTeamsChannel> {
    const teamQuery = new URLSearchParams({
      $filter: `displayName eq '${odataString(teamName)}'`,
      $select: "id,displayName",
      $top: "20",
    });
    const teams = await collectPaginated({
      initialEndpoint: `/teams?${teamQuery.toString()}`,
      maxPages: 5,
      maxItems: 100,
      fetchPage: async (endpoint) =>
        parseCollectionPage(
          await this.client.getJson(endpoint, TEAM_ENDPOINT),
          parseNamedResource,
          TEAM_ENDPOINT,
        ),
    });
    const team = exactResource(
      teams.items,
      teamName,
      TEAM_ENDPOINT,
      "TEAM_NOT_FOUND_OR_AMBIGUOUS",
    );

    const channelQuery = new URLSearchParams({
      $select: "id,displayName,membershipType",
    });
    const channels = await collectPaginated({
      initialEndpoint: `/teams/${segment(team.id)}/channels?${channelQuery.toString()}`,
      maxPages: 20,
      maxItems: 1_000,
      fetchPage: async (endpoint) =>
        parseCollectionPage(
          await this.client.getJson(endpoint, CHANNEL_ENDPOINT),
          parseNamedResource,
          CHANNEL_ENDPOINT,
        ),
    });
    const channel = exactResource(
      channels.items,
      channelName,
      CHANNEL_ENDPOINT,
      "CHANNEL_NOT_FOUND_OR_AMBIGUOUS",
    );

    return {
      teamId: team.id,
      channelId: channel.id,
      membershipType: channel.membershipType ?? null,
    };
  }

  async fetchLatest(options: {
    channel: ResolvedTeamsChannel;
    rootMessageLimit: number;
    maxRepliesPerRoot?: number;
  }): Promise<FetchedTeamsBatch> {
    const maxRepliesPerRoot = options.maxRepliesPerRoot ?? 100;
    const rootPath = `/teams/${segment(options.channel.teamId)}/channels/${segment(options.channel.channelId)}/messages`;
    const roots = await collectPaginated({
      initialEndpoint: `${rootPath}?$top=50`,
      maxPages: 20,
      maxItems: options.rootMessageLimit,
      fetchPage: async (endpoint) =>
        parseCollectionPage(
          await this.client.getJson(endpoint, MESSAGES_ENDPOINT),
          parseMessage,
          MESSAGES_ENDPOINT,
        ),
    });
    const fetched: FetchedGraphMessage[] = roots.items.map((payload) => ({
      payload,
      rootExternalMessageId: null,
    }));
    let repliesSeen = 0;

    for (const root of roots.items) {
      const rootId = nonEmptyString(root.id);
      if (!rootId) continue;
      const replies = await collectPaginated({
        initialEndpoint: `${rootPath}/${segment(rootId)}/replies?$top=50`,
        maxPages: 20,
        maxItems: maxRepliesPerRoot,
        fetchPage: async (endpoint) =>
          parseCollectionPage(
            await this.client.getJson(endpoint, REPLIES_ENDPOINT),
            parseMessage,
            REPLIES_ENDPOINT,
          ),
      });
      repliesSeen += replies.items.length;
      fetched.push(
        ...replies.items.map((payload) => ({
          payload,
          rootExternalMessageId: rootId,
        })),
      );
    }

    return {
      channel: options.channel,
      messages: fetched,
      rootMessagesSeen: roots.items.length,
      repliesSeen,
    };
  }

  async fetchCatchup(options: {
    channel: ResolvedTeamsChannel;
    since: string;
    until: string;
    messageLimit: number;
  }): Promise<FetchedTeamsBatch> {
    const since = new Date(options.since);
    const until = new Date(options.until);
    if (
      !Number.isFinite(since.valueOf()) ||
      !Number.isFinite(until.valueOf()) ||
      until <= since
    ) {
      throw new GraphRequestError({
        endpoint: HISTORY_ENDPOINT,
        httpStatus: null,
        code: "INVALID_CATCHUP_RANGE",
        description: "Catch-up requires a valid bounded date range.",
      });
    }
    const query = new URLSearchParams({
      $top: "50",
      $filter:
        `lastModifiedDateTime gt ${since.toISOString()} ` +
        `and lastModifiedDateTime lt ${until.toISOString()}`,
    });
    const history = await collectPaginated({
      initialEndpoint: `/teams/${segment(options.channel.teamId)}/channels/getAllMessages?${query.toString()}`,
      maxPages: 20,
      maxItems: Math.min(Math.max(options.messageLimit * 10, 500), 5_000),
      fetchPage: async (endpoint) =>
        parseCollectionPage(
          await this.client.getJson(endpoint, HISTORY_ENDPOINT),
          parseMessage,
          HISTORY_ENDPOINT,
        ),
    });
    const seenMessageIds = new Set<string>();
    const targetMessages = history.items
      .filter((message) => {
        const channelIdentity = isRecord(message.channelIdentity)
          ? message.channelIdentity
          : null;
        const messageId = nonEmptyString(message.id);
        if (
          channelIdentity?.channelId !== options.channel.channelId ||
          !messageId ||
          seenMessageIds.has(messageId)
        ) {
          return false;
        }
        seenMessageIds.add(messageId);
        return true;
      })
      .slice(0, options.messageLimit);
    const messages = targetMessages.map((payload): FetchedGraphMessage => ({
      payload,
      rootExternalMessageId: nonEmptyString(payload.replyToId),
    }));
    const repliesSeen = messages.filter(
      (message) => message.rootExternalMessageId !== null,
    ).length;

    return {
      channel: options.channel,
      messages,
      rootMessagesSeen: messages.length - repliesSeen,
      repliesSeen,
    };
  }
}
