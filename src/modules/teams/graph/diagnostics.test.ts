import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatGraphDiagnostics } from "./format";
import type { GraphDiagnosticReport } from "./types";

describe("Graph diagnostic formatting", () => {
  it("does not leak credentials, tokens, email addresses, or raw error URLs", () => {
    const secret = "opaque-client-secret";
    const report: GraphDiagnosticReport = {
      auth: {
        status: "PASS",
        endpoint:
          "POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        tokenType: "Bearer",
        expiresIn: 3_599,
      },
      teamDiscovery: {
        status: "PASS",
        endpoint: "GET /teams",
        teamId: "safe-team-id",
        exactMatchCount: 1,
      },
      channelDiscovery: {
        status: "PASS",
        endpoint: "GET /teams/safe-team-id/channels",
        channelId: "19:private-channel@thread.tacv2",
        membershipType: "private",
        exactMatchCount: 1,
      },
      channelMessagesRead: {
        status: "PASS",
        endpoint: "GET /teams/safe-team-id/channels/safe-channel-id/messages",
        messageCount: 0,
        hasNextLink: false,
        paginationComplete: true,
      },
      channelRepliesRead: {
        status: "NOT_TESTED_NO_MESSAGE",
        endpoint: "GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies",
      },
      authorAadIdAvailable: {
        status: "NOT_TESTED_NO_MESSAGE",
        inspectedMessageCount: 0,
        messagesWithAadUserId: 0,
      },
      filesRead: {
        status: "NOT_TESTED_NO_ATTACHMENT",
        endpoint: "GET /shares/{encoded-sharing-url}/driveItem/content",
        attachmentTypes: {
          hostedContent: 0,
          reference: 0,
          forwardedMessageReference: 0,
          unknown: 0,
        },
      },
      imageFileRead: {
        status: "NOT_TESTED_NO_ATTACHMENT",
        representation: "not_detected",
      },
      audioFileRead: {
        status: "NOT_TESTED_NO_ATTACHMENT",
        representation: "not_detected",
      },
      hostedContentRead: {
        status: "NOT_TESTED",
        endpoint: "GET /hostedContents/{id}/$value",
        detectedCount: 0,
      },
      historyCatchup: {
        status: "PASS",
        endpoint: "GET /teams/safe-team-id/channels/getAllMessages",
        messageCount: 0,
        dateFilterAccepted: true,
        hasNextLink: false,
        paginationHandlingAvailable: true,
      },
      usersRead: {
        status: "FAIL",
        endpoint: "GET /users?$select=id&$top=1",
        error: {
          endpoint: "GET /users?$select=id&$top=1",
          httpStatus: 403,
          code: "Authorization_RequestDenied",
          description: `client_secret=${secret} Authorization: Bearer abcdefghijkl.mnopqrstuvwx.yzABCDEFGHIJ manager@example.com https://tenant.example/item`,
        },
      },
      normalChannelSendAppOnly: {
        status: "NOT_SUPPORTED",
        reason: "Delegated permission is required.",
      },
      errors: [
        {
          endpoint: "GET /users?$select=id&$top=1",
          httpStatus: 403,
          code: "Authorization_RequestDenied",
          description: `client_secret=${secret} Authorization: Bearer abcdefghijkl.mnopqrstuvwx.yzABCDEFGHIJ manager@example.com https://tenant.example/item`,
        },
      ],
    };

    const output = formatGraphDiagnostics(report, [secret]);

    expect(output).toContain("AUTH_TOKEN");
    expect(output).toContain("auth.token_type=Bearer");
    expect(output).not.toContain("safe-team-id");
    expect(output).not.toContain("19:private-channel@thread.tacv2");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("abcdefghijkl");
    expect(output).not.toContain("manager@example.com");
    expect(output).not.toContain("tenant.example");
  });
});
