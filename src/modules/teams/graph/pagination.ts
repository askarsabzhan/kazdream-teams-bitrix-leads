import "server-only";

import { GraphRequestError } from "./client";
import type {
  GraphCollectionPage,
  PaginationResult,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCollectionPage<T>(
  input: unknown,
  parseItem: (item: unknown) => T | undefined,
  endpoint: string,
): GraphCollectionPage<T> {
  if (!isRecord(input) || !Array.isArray(input.value)) {
    throw new GraphRequestError({
      endpoint,
      httpStatus: null,
      code: "INVALID_COLLECTION_RESPONSE",
      description: "Microsoft Graph returned an invalid collection response.",
    });
  }

  const value = input.value
    .map((item) => parseItem(item))
    .filter((item): item is T => item !== undefined);
  const nextLink = input["@odata.nextLink"];

  if (nextLink !== undefined && typeof nextLink !== "string") {
    throw new GraphRequestError({
      endpoint,
      httpStatus: null,
      code: "INVALID_NEXT_LINK",
      description: "Microsoft Graph returned an invalid pagination link.",
    });
  }

  return {
    value,
    ...(typeof nextLink === "string" ? { nextLink } : {}),
  };
}

export async function collectPaginated<T>(options: {
  initialEndpoint: string;
  fetchPage: (endpoint: string) => Promise<GraphCollectionPage<T>>;
  maxPages?: number;
  maxItems?: number;
}): Promise<PaginationResult<T>> {
  const maxPages = options.maxPages ?? 100;
  const maxItems = options.maxItems ?? 5_000;
  const items: T[] = [];
  let nextEndpoint: string | undefined = options.initialEndpoint;
  let pageCount = 0;
  let initialHadNextLink = false;

  while (nextEndpoint && pageCount < maxPages && items.length < maxItems) {
    const page = await options.fetchPage(nextEndpoint);
    pageCount += 1;
    if (pageCount === 1) {
      initialHadNextLink = page.nextLink !== undefined;
    }
    items.push(...page.value.slice(0, maxItems - items.length));
    nextEndpoint = page.nextLink;
  }

  return {
    items,
    pageCount,
    initialHadNextLink,
    complete: nextEndpoint === undefined,
    ...(nextEndpoint ? { remainingNextLink: nextEndpoint } : {}),
  };
}
