import { describe, expect, it } from "vitest";

import { buildPublicBitrixLeadUrl } from "./public-link";

describe("public Bitrix lead link", () => {
  it("builds a lead details link from a safe public portal origin", () => {
    expect(buildPublicBitrixLeadUrl("https://tenant.bitrix24.example/", 42)).toBe(
      "https://tenant.bitrix24.example/crm/lead/details/42/",
    );
  });

  it("cannot use a webhook URL", () => {
    expect(
      buildPublicBitrixLeadUrl(
        "https://tenant.bitrix24.example/rest/25/webhook-token/",
        42,
      ),
    ).toBeNull();
  });

  it("hides the action without both public portal URL and lead ID", () => {
    expect(buildPublicBitrixLeadUrl(undefined, 42)).toBeNull();
    expect(buildPublicBitrixLeadUrl("https://tenant.bitrix24.example/", null)).toBeNull();
    expect(buildPublicBitrixLeadUrl("https://tenant.bitrix24.example/", 0)).toBeNull();
  });
});
