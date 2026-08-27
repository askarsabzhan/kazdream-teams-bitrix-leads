import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GraphRequestError, type GraphClient } from "../graph/client";

import { GraphAttachmentByteSource } from "./graph-source";
import type { AttachmentAcquisitionClaim } from "./types";

function claim(
  overrides: Partial<AttachmentAcquisitionClaim>,
): AttachmentAcquisitionClaim {
  return {
    attachmentId: "22222222-2222-4222-8222-222222222222",
    teamsMessageId: "11111111-1111-4111-8111-111111111111",
    leaseId: "33333333-3333-4333-8333-333333333333",
    tenantId: "tenant-test",
    teamId: "team-test",
    channelId: "channel-test",
    externalMessageId: "message-test",
    rootExternalMessageId: null,
    attachmentKind: "hosted_content",
    sourceLocator: { hosted_content_id: "hosted-test" },
    declaredMimeType: null,
    sourceSizeBytes: null,
    fetchAttempts: 1,
    ...overrides,
  };
}

describe("Graph attachment byte source", () => {
  it("downloads hosted content through the persisted hosted-content ID", async () => {
    const graph = {
      getBoundedBytes: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2]),
        contentType: "image/png",
      })),
    } as unknown as GraphClient;
    const source = new GraphAttachmentByteSource(graph, "tenant-test");

    const result = await source.download(claim({}));

    expect(result.declaredMimeType).toBe("image/png");
    expect([...result.bytes]).toEqual([1, 2]);
    expect(graph.getBoundedBytes).toHaveBeenCalledOnce();
  });

  it("uses a bounded identity fallback before resolving DriveItem bytes", async () => {
    const graph = {
      getJson: vi
        .fn()
        .mockRejectedValueOnce(
          new GraphRequestError({
            endpoint:
              "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}?$select=id,attachments",
            httpStatus: null,
            code: "INVALID_JSON_RESPONSE",
            description: "Synthetic empty item projection.",
          }),
        )
        .mockResolvedValueOnce({
          value: [
            {
              id: "message-test",
              attachments: [
                {
                  id: "reference-test",
                  contentType: "reference",
                  contentUrl: "https://example.invalid/fresh-reference",
                },
              ],
            },
          ],
        })
        .mockResolvedValueOnce({
          size: 3,
          file: { mimeType: "audio/mpeg" },
        }),
      getBoundedBytes: vi.fn(async () => ({
        bytes: new Uint8Array([0x49, 0x44, 0x33]),
        contentType: "application/octet-stream",
      })),
    } as unknown as GraphClient;
    const source = new GraphAttachmentByteSource(graph, "tenant-test");

    const result = await source.download(
      claim({
        attachmentKind: "reference",
        sourceLocator: { attachment_id: "reference-test" },
      }),
    );

    expect(result.declaredMimeType).toBe("audio/mpeg");
    expect(graph.getJson).toHaveBeenCalledTimes(3);
    expect(graph.getJson).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/messages?$top=50"),
      expect.stringContaining("bounded identity fallback"),
    );
    expect(graph.getBoundedBytes).toHaveBeenCalledOnce();
  });
});
