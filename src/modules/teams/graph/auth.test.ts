import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GraphRequestError } from "./client";
import { ClientCredentialsTokenProvider, parseTokenResponse } from "./auth";

const credentials = {
  tenantId: "test-tenant",
  clientId: "test-client",
  clientSecret: "test-secret",
};

describe("Microsoft Graph token parsing", () => {
  it("parses the required token fields and computes expiry", () => {
    const token = parseTokenResponse(
      {
        access_token: "memory-only-token",
        token_type: "Bearer",
        expires_in: 3_600,
      },
      1_000,
    );

    expect(token).toEqual({
      accessToken: "memory-only-token",
      tokenType: "Bearer",
      expiresIn: 3_600,
      expiresAt: 3_601_000,
    });
  });

  it("rejects malformed token responses without including their content", () => {
    expect(() =>
      parseTokenResponse({ access_token: "should-not-appear" }),
    ).toThrowError(GraphRequestError);

    try {
      parseTokenResponse({ access_token: "should-not-appear" });
    } catch (error) {
      expect((error as Error).message).not.toContain("should-not-appear");
    }
  });

  it("reuses a token that remains valid beyond the expiry skew", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        access_token: "memory-only-token",
        token_type: "Bearer",
        expires_in: 120,
      }),
    ) as unknown as typeof fetch;
    const provider = new ClientCredentialsTokenProvider(credentials, {
      fetchImplementation,
    });

    await provider.getAccessToken();
    await provider.getAccessToken();

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("refreshes a token inside the expiry skew", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        access_token: "memory-only-token",
        token_type: "Bearer",
        expires_in: 30,
      }),
    ) as unknown as typeof fetch;
    const provider = new ClientCredentialsTokenProvider(credentials, {
      fetchImplementation,
    });

    await provider.getAccessToken();
    await provider.getAccessToken();

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
