import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readServerEnvironment,
  requireServerEnvironment,
} from "./server";

describe("server environment", () => {
  it("allows integration variables to be absent during bootstrap", () => {
    const environment = readServerEnvironment({});

    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.BITRIX_WEBHOOK_BASE_URL).toBeUndefined();
  });

  it("validates variables only when a feature requires them", () => {
    expect(() =>
      requireServerEnvironment(["MS_TENANT_ID"], {}),
    ).toThrowError("Missing required environment variables: MS_TENANT_ID");

    expect(
      requireServerEnvironment(["MS_TENANT_ID"], {
        MS_TENANT_ID: "tenant-placeholder",
      }).MS_TENANT_ID,
    ).toBe("tenant-placeholder");
  });
});
