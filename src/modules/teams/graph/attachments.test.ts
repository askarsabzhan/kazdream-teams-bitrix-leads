import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyAttachmentTypes,
  classifyMediaKind,
  hasHostedContentReference,
  projectGraphAttachment,
} from "./attachments";
import type { DiagnosticMessageRecord } from "./types";

function message(
  overrides: Partial<DiagnosticMessageRecord>,
): DiagnosticMessageRecord {
  return {
    id: "message-id",
    resourcePath: "/message",
    fieldPresence: {
      id: 1,
      createdDateTime: 1,
      lastModifiedDateTime: 1,
      replyToId: 1,
      messageType: 1,
      fromIdentity: 1,
      attachments: 1,
      hostedContents: 0,
    },
    aadUserIdAvailable: true,
    attachments: [],
    hostedContentReferencePresent: false,
    ...overrides,
  };
}

describe("Graph attachment classification", () => {
  it("projects a reference attachment without retaining its file name", () => {
    const attachment = projectGraphAttachment({
      contentType: "reference",
      contentUrl: "https://example.invalid/shared",
      name: "synthetic-audio.mp3",
    });

    expect(attachment).toEqual({
      contentType: "reference",
      contentUrl: "https://example.invalid/shared",
      mediaKindHint: "audio",
    });
    expect(attachment).not.toHaveProperty("name");
  });

  it("distinguishes hosted content and reference attachments", () => {
    const messages = [
      message({ hostedContentReferencePresent: true }),
      message({ attachments: [{ contentType: "reference" }] }),
    ];

    expect(classifyAttachmentTypes(messages)).toEqual({
      hostedContent: 1,
      reference: 1,
      forwardedMessageReference: 0,
      unknown: 0,
    });
    expect(
      hasHostedContentReference(
        '<img src="/hostedContents/safe-id/$value">',
        [],
      ),
    ).toBe(true);
  });

  it("classifies media using MIME type before the safe extension hint", () => {
    expect(classifyMediaKind("image/png", "audio")).toBe("image");
    expect(classifyMediaKind("application/octet-stream", "audio")).toBe(
      "audio",
    );
  });
});
