import { describe, expect, it } from "vitest";

import { buildLeadHeaderBadges } from "./header-badges";

describe("lead header badges", () => {
  it("omits a null priority without changing the other badges", () => {
    expect(
      buildLeadHeaderBadges({
        leadType: "Partner",
        priority: null,
        crmStatus: "succeeded",
      }),
    ).toEqual([
      { key: "leadType", value: "Partner" },
      { key: "crmStatus", value: "succeeded" },
    ]);
  });

  it("omits every null, empty, or whitespace-only header value", () => {
    expect(
      buildLeadHeaderBadges({
        leadType: "",
        priority: "   ",
        crmStatus: null,
      }),
    ).toEqual([]);
  });

  it("keeps an explicit priority badge", () => {
    expect(
      buildLeadHeaderBadges({
        leadType: "Customer",
        priority: "High",
        crmStatus: "pending",
      }),
    ).toContainEqual({ key: "priority", value: "High" });
  });
});
