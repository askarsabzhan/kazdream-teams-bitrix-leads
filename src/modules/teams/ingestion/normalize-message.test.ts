import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  normalizeGraphMessage,
  TeamsMessageNormalizationError,
} from "./normalize-message";

const context = {
  tenantId: "tenant-id",
  teamId: "team-id",
  channelId: "channel-id",
  observedAt: "2026-08-27T08:00:00.000Z",
};

function rootPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "root-message-id",
    createdDateTime: "2026-08-27T07:00:00Z",
    lastModifiedDateTime: "2026-08-27T07:01:00Z",
    messageType: "message",
    from: { user: { id: "aad-user-id" } },
    body: {
      contentType: "html",
      content:
        'verbatim source <img src="/hostedContents/hosted-content-id/$value">',
    },
    attachments: [
      {
        id: "attachment-id",
        contentType: "reference",
        name: "fixture-audio.mp3",
        contentUrl: "https://files.example.invalid/shared/item?web=1",
      },
    ],
    webUrl: "https://teams.example.invalid/message/root-message-id",
    ...overrides,
  };
}

describe("Teams Graph message normalization", () => {
  it("preserves verbatim body and projects author and attachment metadata", () => {
    const bodyContent = (
      rootPayload().body as { content: string }
    ).content;
    const normalized = normalizeGraphMessage({
      ...context,
      fetched: { payload: rootPayload(), rootExternalMessageId: null },
    });

    expect(normalized).toMatchObject({
      source: "microsoft_teams",
      externalMessageId: "root-message-id",
      rootExternalMessageId: null,
      authorAadUserId: "aad-user-id",
      bodyContentType: "html",
      bodyContent,
      isBot: false,
      isServiceMessage: false,
    });
    expect(normalized.bodyContent).toBe(bodyContent);
    expect(normalized.attachments).toEqual([
      {
        externalAttachmentId: "hosted:hosted-content-id",
        attachmentKind: "hosted_content",
        sourceContentType: "chatMessageHostedContent",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        sourceLocator: { hosted_content_id: "hosted-content-id" },
      },
      {
        externalAttachmentId: "reference:attachment-id",
        attachmentKind: "reference",
        sourceContentType: "reference",
        fileName: "fixture-audio.mp3",
        mimeType: null,
        sizeBytes: null,
        sourceLocator: {
          attachment_id: "attachment-id",
          content_url: "https://files.example.invalid/shared/item?web=1",
        },
      },
    ]);
  });

  it("keeps absent author nullable and preserves explicit reply relationship", () => {
    const normalized = normalizeGraphMessage({
      ...context,
      fetched: {
        payload: rootPayload({
          id: "reply-message-id",
          replyToId: "root-message-id",
          from: null,
          attachments: [],
        }),
        rootExternalMessageId: "root-message-id",
      },
    });

    expect(normalized.authorAadUserId).toBeNull();
    expect(normalized.rootExternalMessageId).toBe("root-message-id");
  });

  it("does not persist a locator URL with signed parameters", () => {
    const normalized = normalizeGraphMessage({
      ...context,
      fetched: {
        payload: rootPayload({
          body: { contentType: "text", content: "source" },
          attachments: [
            {
              id: "attachment-id",
              contentType: "reference",
              contentUrl: "https://files.example.invalid/item?authkey=temporary",
            },
          ],
        }),
        rootExternalMessageId: null,
      },
    });

    expect(normalized.attachments[0]?.sourceLocator).toEqual({
      attachment_id: "attachment-id",
    });
  });

  it("uses a stable source fingerprint and changes it for edited content", () => {
    const first = normalizeGraphMessage({
      ...context,
      fetched: { payload: rootPayload(), rootExternalMessageId: null },
    });
    const replay = normalizeGraphMessage({
      ...context,
      observedAt: "2026-08-27T09:00:00Z",
      fetched: { payload: rootPayload(), rootExternalMessageId: null },
    });
    const edited = normalizeGraphMessage({
      ...context,
      fetched: {
        payload: rootPayload({
          lastModifiedDateTime: "2026-08-27T07:02:00Z",
          body: { contentType: "text", content: "edited source" },
        }),
        rootExternalMessageId: null,
      },
    });

    expect(replay.sourceFingerprint).toBe(first.sourceFingerprint);
    expect(edited.sourceFingerprint).not.toBe(first.sourceFingerprint);
  });

  it("keeps attachment projection differences outside the message fingerprint", () => {
    const withAttachment = normalizeGraphMessage({
      ...context,
      fetched: { payload: rootPayload(), rootExternalMessageId: null },
    });
    const withoutAttachment = normalizeGraphMessage({
      ...context,
      fetched: {
        payload: rootPayload({ attachments: [] }),
        rootExternalMessageId: null,
      },
    });

    expect(withoutAttachment.sourceFingerprint).toBe(
      withAttachment.sourceFingerprint,
    );
  });

  it("rejects a reply whose payload and endpoint roots disagree", () => {
    expect(() =>
      normalizeGraphMessage({
        ...context,
        fetched: {
          payload: rootPayload({ replyToId: "different-root" }),
          rootExternalMessageId: "root-message-id",
        },
      }),
    ).toThrowError(TeamsMessageNormalizationError);
  });
});
