import { describe, expect, it } from "vitest";

import {
  extractGroupingSignals,
  normalizeEmail,
  normalizePhone,
  sharedSignalReason,
} from "./signals";

describe("deterministic grouping signals", () => {
  it("normalizes exact email comparison without correcting the domain", () => {
    expect(normalizeEmail("  UNIT@EXAMPLE.CORN ")).toBe("unit@example.corn");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("normalizes phone formatting while preserving a meaningful leading plus", () => {
    expect(normalizePhone("+000 (000) 000-01")).toBe("+00000000001");
    expect(normalizePhone("000-000-000-01")).toBe("00000000001");
  });

  it("does not guess a missing country code", () => {
    expect(normalizePhone("+000 000 000 01")).not.toBe(
      normalizePhone("000 000 000 01"),
    );
  });

  it("extracts email and phone keys from available evidence", () => {
    const signals = extractGroupingSignals([
      "Contact UNIT@EXAMPLE.INVALID, phone +000 (000) 000-01.",
    ]);
    expect([...signals.emails]).toEqual(["unit@example.invalid"]);
    expect([...signals.phones]).toEqual(["+00000000001"]);
  });

  it("uses only explicitly labeled name and company hints", () => {
    const signals = extractGroupingSignals([
      "Name: PLACEHOLDER CONTACT\nCompany: PLACEHOLDER ORG",
    ]);
    expect([...signals.nameHints]).toEqual(["placeholder contact"]);
    expect([...signals.companyHints]).toEqual(["placeholder org"]);
  });

  it("treats name plus company as secondary when phones differ", () => {
    const left = extractGroupingSignals([
      "Name: PLACEHOLDER CONTACT\nCompany: PLACEHOLDER ORG\n+00000000001",
    ]);
    const right = extractGroupingSignals([
      "Name: PLACEHOLDER CONTACT\nCompany: PLACEHOLDER ORG\n+00000000002",
    ]);
    expect(sharedSignalReason(left, right)).toBe("name_company");
  });
});
