import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseAttachmentAcquisitionRepository } from "./repository";
import type { AttachmentAcquisitionClaim } from "./types";

const CLAIM: AttachmentAcquisitionClaim = {
  attachmentId: "22222222-2222-4222-8222-222222222222",
  teamsMessageId: "11111111-1111-4111-8111-111111111111",
  leaseId: "33333333-3333-4333-8333-333333333333",
  tenantId: "tenant-test",
  teamId: "team-test",
  channelId: "channel-test",
  externalMessageId: "message-test",
  rootExternalMessageId: null,
  attachmentKind: "reference",
  sourceLocator: { attachment_id: "reference-test" },
  declaredMimeType: "audio/mpeg",
  sourceSizeBytes: 3,
  fetchAttempts: 5,
};

describe("attachment acquisition repository", () => {
  it("accepts durable retry exhaustion as a valid outcome", async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: [
          {
            attachment_id: CLAIM.attachmentId,
            fetch_state: "permanent_failed",
          },
        ],
        error: null,
      })),
    };
    const repository = new SupabaseAttachmentAcquisitionRepository(
      client as never,
    );

    await expect(
      repository.recordOutcome({
        claim: CLAIM,
        outcome: "retryable_failed",
        errorCode: "GRAPH_NETWORK_ERROR",
      }),
    ).resolves.toBeUndefined();
  });
});
