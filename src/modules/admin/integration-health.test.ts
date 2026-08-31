import { describe, expect, it } from "vitest";

import { buildIntegrationHealth } from "./integration-health";

describe("admin integration health", () => {
  it("uses persisted successful processing when worker secrets are not present in WEB", () => {
    expect(
      buildIntegrationHealth({
        environment: {
          teams: false,
          openAI: false,
          supabase: false,
          bitrix: false,
        },
        persisted: {
          supabaseConnected: true,
          hasTeamsMessages: true,
          hasOpenAISuccess: true,
          hasBitrixSuccess: true,
        },
      }),
    ).toEqual([
      { name: "Microsoft Graph", configured: true },
      { name: "OpenAI", configured: true },
      { name: "Supabase", configured: true },
      { name: "Bitrix", configured: true },
    ]);
  });

  it("does not claim an integration without environment or persisted evidence", () => {
    expect(
      buildIntegrationHealth({
        environment: {
          teams: false,
          openAI: false,
          supabase: false,
          bitrix: false,
        },
        persisted: {
          supabaseConnected: false,
          hasTeamsMessages: false,
          hasOpenAISuccess: false,
          hasBitrixSuccess: false,
        },
      }).every((integration) => !integration.configured),
    ).toBe(true);
  });
});
