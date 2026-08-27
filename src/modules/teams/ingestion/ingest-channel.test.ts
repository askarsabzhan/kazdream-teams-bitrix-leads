import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ingestFetchedBatch } from "./ingest-channel";
import type {
  FetchedTeamsBatch,
  MessagePersistenceOutcome,
  TeamsMessageRepository,
} from "./types";

function payload(id: string, replyToId?: string) {
  return {
    id,
    createdDateTime: "2026-08-27T07:00:00Z",
    lastModifiedDateTime: "2026-08-27T07:00:00Z",
    messageType: "message",
    from: null,
    body: { contentType: "text", content: "source" },
    attachments: [],
    ...(replyToId ? { replyToId } : {}),
  };
}

const batch: FetchedTeamsBatch = {
  channel: {
    teamId: "team-id",
    channelId: "channel-id",
    membershipType: "private",
  },
  messages: [
    { payload: payload("root-id"), rootExternalMessageId: null },
    {
      payload: payload("reply-id", "root-id"),
      rootExternalMessageId: "root-id",
    },
  ],
  rootMessagesSeen: 1,
  repliesSeen: 1,
};

class OutcomeRepository implements TeamsMessageRepository {
  private index = 0;

  constructor(private readonly outcomes: MessagePersistenceOutcome[]) {}

  async persistMessage(): Promise<MessagePersistenceOutcome> {
    const outcome = this.outcomes[this.index];
    this.index += 1;
    if (!outcome) throw new Error("Missing test outcome");
    return outcome;
  }
}

describe("Teams channel ingestion", () => {
  it("normalizes a dry run without invoking persistence", async () => {
    const summary = await ingestFetchedBatch({
      batch,
      tenantId: "tenant-id",
      mode: "latest",
      dryRun: true,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(summary).toMatchObject({
      dryRun: true,
      messagesSeen: 2,
      rootMessagesSeen: 1,
      repliesSeen: 1,
      messagesInserted: 0,
      jobsEnqueued: 0,
    });
  });

  it("aggregates inserted, updated, unchanged, attachment, and job outcomes", async () => {
    const repository = new OutcomeRepository([
      {
        messageId: "db-root",
        result: "inserted",
        contentRevision: 1,
        attachmentsInserted: 1,
        jobsEnqueued: 1,
      },
      {
        messageId: "db-reply",
        result: "unchanged",
        contentRevision: 1,
        attachmentsInserted: 0,
        jobsEnqueued: 0,
      },
    ]);
    const summary = await ingestFetchedBatch({
      batch,
      tenantId: "tenant-id",
      mode: "latest",
      dryRun: false,
      repository,
      observedAt: "2026-08-27T08:00:00Z",
    });

    expect(summary).toMatchObject({
      messagesInserted: 1,
      messagesUpdated: 0,
      messagesUnchanged: 1,
      attachmentsInserted: 1,
      jobsEnqueued: 1,
    });
  });
});
