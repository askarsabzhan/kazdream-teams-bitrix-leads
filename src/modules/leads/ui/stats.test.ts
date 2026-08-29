import { describe, expect, it } from "vitest";

import { calculateLeadCounters } from "./stats";

describe("lead counters", () => {
  it("counts real lead and CRM values without inventing analytics", () => {
    expect(
      calculateLeadCounters([
        { crmStatus: "succeeded", leadType: "Customer" },
        { crmStatus: "succeeded", leadType: "partner" },
        { crmStatus: "pending", leadType: "customer" },
      ]),
    ).toEqual({ total: 3, synced: 2, customers: 2, partners: 1 });
  });
});
