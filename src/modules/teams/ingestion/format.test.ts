import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatIngestionReport } from "./format";

describe("Teams ingestion report formatting", () => {
  it("prints only bounded metrics and verification statuses", () => {
    const output = formatIngestionReport(
      {
        mode: "latest",
        dryRun: false,
        messagesSeen: 9,
        rootMessagesSeen: 8,
        repliesSeen: 1,
        messagesInserted: 9,
        messagesUpdated: 0,
        messagesUnchanged: 0,
        attachmentsSeen: 2,
        hostedAttachmentsSeen: 1,
        referenceAttachmentsSeen: 1,
        attachmentsInserted: 2,
        jobsEnqueued: 9,
      },
      {
        messagesPersisted: 9,
        rootMessagesPersisted: 8,
        repliesPersisted: 1,
        messagesWithAuthor: 7,
        messagesWithoutAuthor: 2,
        attachmentsPersisted: 2,
        jobsPersisted: 9,
        duplicateMessageIdentities: 0,
        duplicateAttachmentIdentities: 0,
        duplicateJobRevisions: 0,
        replyRelationshipsValid: true,
        currentRevisionJobsComplete: true,
      },
    );

    expect(output).toContain("messages_inserted=9");
    expect(output).toContain("duplicate_message_identities=0");
    expect(output).toContain("reply_relationships_valid=true");
    expect(output).not.toContain("tenant-id");
    expect(output).not.toContain("message-id");
  });
});
